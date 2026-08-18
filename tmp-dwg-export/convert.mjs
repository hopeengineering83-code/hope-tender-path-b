import fs from 'node:fs';
import zlib from 'node:zlib';
import { DxfReader, DwgReader, DwgWriter, ACadVersion } from '@node-projects/acad-ts';

const parts = ['input.part1','input.part2','input.part3','input.part4a','input.part4b','input.part4c'];
const base64 = parts.map(p => fs.readFileSync(new URL(`./${p}`, import.meta.url), 'utf8').trim()).join('');
const dxfBytes = zlib.gunzipSync(Buffer.from(base64, 'base64'));
console.log(`Reconstructed DXF: ${dxfBytes.length} bytes`);
if (dxfBytes.length !== 200001) throw new Error(`Unexpected DXF byte size: ${dxfBytes.length}`);

const messages = [];
const doc = DxfReader.readFromStream(new Uint8Array(dxfBytes), (_sender, e) => {
  const msg = e?.message ?? e?.Message;
  if (msg) messages.push(String(msg));
});
doc.header.version = ACadVersion.AC1032;

// acad-ts currently copies the supplied Uint8Array when it creates the internal
// DWG file-header writer. Read the serialized bytes back from that internal
// writer stream after write() completes rather than from the caller's buffer.
const capacity = 64 * 1024 * 1024;
const writer = new DwgWriter(new Uint8Array(capacity), doc);
writer.write();
const fh = writer['_fileHeaderWriter'];
const n = fh?.bytesWritten ?? writer.bytesWritten;
const serialized = fh?.['_stream'];
if (!(serialized instanceof Uint8Array) || !n || n < 4096) {
  throw new Error(`DWG writer returned invalid output: bytes=${n}, stream=${serialized?.constructor?.name}`);
}
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
const entities = readback?.modelSpace?.entities;
const entityCount = typeof entities?.length === 'number' ? entities.length : [...(entities ?? [])].length;
const qa = {
  sourceDxfBytes: dxfBytes.length,
  dwgBytes: n,
  dwgSignature: sig,
  dwgVersion: 'AC1032',
  modelSpaceEntityCount: entityCount,
  notifications: messages.slice(0, 100),
  status: 'PASS - DWG written and read back successfully'
};
fs.writeFileSync('tmp-dwg-export/output/DWG_QA.json', JSON.stringify(qa, null, 2));
console.log(JSON.stringify(qa, null, 2));
