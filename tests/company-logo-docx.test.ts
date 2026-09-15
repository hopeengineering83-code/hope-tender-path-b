import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Packer } from "docx";
import JSZip from "jszip";
import {
  buildProfessionalDocument,
  markdownToDocx,
} from "../lib/engine/generate-elite";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=",
  "base64",
);

describe("Company Vault logo in generated DOCX", () => {
  it("embeds the active verified logo supplied by the generation path", async () => {
    const document = buildProfessionalDocument({
      tenderTitle: "Grounded Tender",
      clientName: "Procuring Entity",
      companyName: "Evidence Company",
      children: markdownToDocx("# Delivery\n\nGrounded content."),
      logo: {
        data: ONE_PIXEL_PNG,
        type: "png",
        width: 64,
        height: 64,
      },
    });

    const bytes = await Packer.toBuffer(document);
    const zip = await JSZip.loadAsync(bytes);
    const media = Object.keys(zip.files).filter((path) => path.startsWith("word/media/"));
    const documentXml = await zip.file("word/document.xml")?.async("string");

    assert.ok(media.length >= 1);
    assert.match(documentXml ?? "", /Company logo/);
  });
});
