// Standalone repro: render page 1 of Jesse's PDF, show full error stack.
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const PDF = "C:/Users/Chint/Downloads/ELECTRICAL (2) (1).pdf";
const bytes = new Uint8Array(fs.readFileSync(PDF));

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(cc, width, height) {
    cc.canvas.width = width;
    cc.canvas.height = height;
  }
  destroy(cc) {
    cc.canvas.width = 0;
    cc.canvas.height = 0;
    cc.canvas = null;
    cc.context = null;
  }
}

try {
  console.log("[start] opening doc, bytes:", bytes.byteLength);
  const doc = await pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;
  console.log("[ok] doc loaded, pages:", doc.numPages);

  const page = await doc.getPage(2);
  const viewport = page.getViewport({ scale: 500 / 72 });
  console.log("[ok] page 2 viewport:", viewport.width, "x", viewport.height);

  const cc = doc.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  cc.context.fillStyle = "#ffffff";
  cc.context.fillRect(0, 0, Math.ceil(viewport.width), Math.ceil(viewport.height));
  console.log("[ok] canvas + context allocated via pdfjs factory");

  await page.render({ canvasContext: cc.context, viewport }).promise;
  console.log("[ok] render complete");

  const buf = cc.canvas.toBuffer("image/png");
  fs.writeFileSync("scripts/test-render-page2.png", buf);
  console.log("[ok] wrote scripts/test-render-page2.png:", buf.byteLength, "bytes");
} catch (e) {
  console.error("[fail]", e);
  process.exit(1);
}
