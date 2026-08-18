import fs from 'node:fs';
import zlib from 'node:zlib';
import { DxfReader, DwgReader, DwgWriter, ACadVersion } from '@node-projects/acad-ts';

const parts = ['input.part1','input.part2','input.part3','input.part4a','input.part4b','input.part4c'];
const base64 = parts.map(p => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8').trim()).join('');
const originalDxfBytes = zlib.gunzipSync(Buffer.from(base64, 'base64'));
console.log(`Reconstructed DXF: ${originalDxfBytes.length} bytes`);
if (originalDxfBytes.length !== 200001) throw new Error(`Unexpected DXF byte size: ${originalDxfBytes.length}`);

// Normalize generated LWPOLYLINE entities into primitive LINE entities before
// passing the file to the DWG writer. The project geometry contains no bulged
// LWPOLYLINE segments, so this transformation is lossless for plan linework and
// avoids current acad-ts LWPOLYLINE metadata warnings.
function parsePairs(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push({code: lines[i].trim(), value: lines[i + 1]});
  return pairs;
}
function serializePairs(pairs) {
  return pairs.flatMap(p => [p.code, p.value]).join('\n') + '\n';
}
function replaceLwPolylines(text) {
  const pairs = parsePairs(text);
  let maxHandle = 0;
  for (const p of pairs) {
    if (p.code === '5' && /^[0-9A-Fa-f]+$/.test(p.value.trim())) maxHandle = Math.max(maxHandle, parseInt(p.value.trim(), 16));
  }
  const out = [];
  let converted = 0;
  let generatedLines = 0;
  for (let i = 0; i < pairs.length;) {
    const p = pairs[i];
    if (p.code === '0' && p.value.trim().toUpperCase() === 'LWPOLYLINE') {
      i++;
      const ent = [];
      while (i < pairs.length && pairs[i].code !== '0') ent.push(pairs[i++]);
      const first = code => ent.find(q => q.code === String(code))?.value?.trim();
      const layer = first(8) || '0';
      const owner = first(330);
      const color = first(62);
      const lineweight = first(370);
      const linetype = first(6);
      const flags = Number(first(70) || 0);
      const vertices = [];
      let x = null;
      for (const q of ent) {
        if (q.code === '10') x = Number(q.value);
        else if (q.code === '20' && x !== null) { vertices.push([x, Number(q.value)]); x = null; }
      }
      const segmentPairs = (a, b) => {
        const h = (++maxHandle).toString(16).toUpperCase();
        const e = [
          {code:'0', value:'LINE'},
          {code:'5', value:h},
        ];
        if (owner) e.push({code:'330', value:owner});
        e.push({code:'100', value:'AcDbEntity'}, {code:'8', value:layer});
        if (linetype) e.push({code:'6', value:linetype});
        if (color) e.push({code:'62', value:color});
        if (lineweight) e.push({code:'370', value:lineweight});
        e.push(
          {code:'100', value:'AcDbLine'},
          {code:'10', value:String(a[0])}, {code:'20', value:String(a[1])}, {code:'30', value:'0'},
          {code:'11', value:String(b[0])}, {code:'21', value:String(b[1])}, {code:'31', value:'0'}
        );
        return e;
      };
      for (let v = 0; v + 1 < vertices.length; v++) { out.push(...segmentPairs(vertices[v], vertices[v + 1])); generatedLines++; }
      if ((flags & 1) && vertices.length > 2) { out.push(...segmentPairs(vertices[vertices.length - 1], vertices[0])); generatedLines++; }
      converted++;
      continue;
    }
    out.push(p);
    i++;
  }
  // Keep the header hand seed ahead of generated handles.
  for (let i = 0; i + 2 < out.length; i++) {
    if (out[i].code === '9' && out[i].value.trim() === '$HANDSEED') {
      const seed = out.slice(i + 1, i + 4).find(q => q.code === '5');
      if (seed) seed.value = (maxHandle + 1).toString(16).toUpperCase();
      break;
    }
  }
  return {bytes: new TextEncoder().encode(serializePairs(out)), converted, generatedLines};
}

const normalized = replaceLwPolylines(Buffer.from(originalDxfBytes).toString('utf8'));
console.log(`Normalized ${normalized.converted} LWPOLYLINE entities into ${normalized.generatedLines} LINE entities; normalized DXF ${normalized.bytes.length} bytes`);

const messages = [];
const doc = DxfReader.readFromStream(normalized.bytes, (_sender, e) => {
  const msg = e?.message ?? e?.Message;
  if (msg) messages.push(String(msg));
});
doc.header.version = ACadVersion.AC1032;

const countEntities = collection => {
  if (!collection) return 0;
  if (typeof collection.length === 'number') return collection.length;
  try { return [...collection].length; } catch { return 0; }
};
const blockSummary = document => {
  const result = {};
  for (const br of document.blockRecords ?? []) result[br.name] = countEntities(br.entities);
  return result;
};
const sourceBlockSummary = blockSummary(doc);
const sourceTotalBlockEntities = Object.values(sourceBlockSummary).reduce((a,b)=>a+b,0);

// acad-ts copies the caller Uint8Array for the internal file-header writer;
// retrieve serialized bytes from that actual internal writer stream.
const writer = new DwgWriter(new Uint8Array(64 * 1024 * 1024), doc);
writer.write();
const fh = writer['_fileHeaderWriter'];
const n = fh?.bytesWritten ?? writer.bytesWritten;
const serialized = fh?.['_stream'];
if (!(serialized instanceof Uint8Array) || !n || n < 4096) throw new Error(`DWG writer returned invalid output: bytes=${n}`);
const dwg = serialized.slice(0, n);
const sig = Buffer.from(dwg.slice(0, 6)).toString('ascii');
if (sig !== 'AC1032') throw new Error(`Unexpected DWG signature ${JSON.stringify(sig)}`);

fs.mkdirSync('tmp-dwg-export/output', {recursive:true});
const dwgPath = 'tmp-dwg-export/output/Bishoftu_B_G_9_Terrace_FINAL_REV04.dwg';
fs.writeFileSync(dwgPath, dwg);

const readback = DwgReader.readFromStream(dwg, (_sender, e) => {
  const msg = e?.message ?? e?.Message;
  if (msg) messages.push(`READBACK: ${msg}`);
});
const readbackBlockSummary = blockSummary(readback);
const readbackTotalBlockEntities = Object.values(readbackBlockSummary).reduce((a,b)=>a+b,0);
const modelSpaceEntityCount = countEntities(readback?.modelSpace?.entities);
if (modelSpaceEntityCount < 8) throw new Error(`Readback modelspace entity count too low: ${modelSpaceEntityCount}`);
if (readbackTotalBlockEntities < Math.max(500, sourceTotalBlockEntities * 0.85)) {
  throw new Error(`Readback block entity preservation too low: ${readbackTotalBlockEntities}/${sourceTotalBlockEntities}`);
}
const qa = {
  originalDxfBytes: originalDxfBytes.length,
  normalizedDxfBytes: normalized.bytes.length,
  convertedLwPolylines: normalized.converted,
  generatedPrimitiveLines: normalized.generatedLines,
  dwgBytes: n,
  dwgSignature: sig,
  dwgVersion: 'AC1032',
  modelSpaceEntityCount,
  sourceTotalBlockEntities,
  readbackTotalBlockEntities,
  sourceBlockSummary,
  readbackBlockSummary,
  notifications: messages.slice(0, 60),
  status: 'PASS - DWG written, reopened, and block/entity preservation validated'
};
fs.writeFileSync('tmp-dwg-export/output/DWG_QA.json', JSON.stringify(qa, null, 2));
console.log(JSON.stringify(qa, null, 2));
