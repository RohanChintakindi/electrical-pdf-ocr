// Renders PDF pages to PNG buffers using pdfjs-dist v4 (legacy/node build).
// Uses pdfjs's *own* NodeCanvasFactory so Path2D / DOMMatrix / Canvas all
// resolve to the same @napi-rs/canvas instance pdfjs polyfilled globally.
// Mixing instances triggers `ctx.fill(path)` failures.
import sharp from "sharp";
// pdfjs's NodeCanvasFactory does `require("@napi-rs/canvas")` at runtime via
// a string-literal require Next's tracer can't see. Import it here so the
// dep makes it into the function bundle.
import "@napi-rs/canvas";

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  png: Buffer;
}

const DPI = 500;
const PDF_POINTS_PER_INCH = 72;
const SCALE = DPI / PDF_POINTS_PER_INCH;

let pdfjsPromise: Promise<any> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

async function openDoc(pdfBytes: Uint8Array) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // On Vercel serverless the worker file isn't reachable; run inline.
    disableWorker: true,
    useWorkerFetch: false,
  });
  return task.promise;
}

export async function renderPdfPages(pdfBytes: Uint8Array): Promise<RenderedPage[]> {
  const doc = await openDoc(pdfBytes);
  try {
    const pages: RenderedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      pages.push(await renderOne(doc, i));
    }
    return pages;
  } finally {
    try { await doc.destroy(); } catch {}
  }
}

export async function renderPdfPage(pdfBytes: Uint8Array, pageNumber: number): Promise<RenderedPage> {
  const doc = await openDoc(pdfBytes);
  try {
    return await renderOne(doc, pageNumber);
  } finally {
    try { await doc.destroy(); } catch {}
  }
}

/** Count pages and pick the largest by viewport area — no rendering. */
export async function inspectPdf(pdfBytes: Uint8Array): Promise<{ pageCount: number; largestPage: number }> {
  const doc = await openDoc(pdfBytes);
  try {
    const pageCount = doc.numPages;
    let largestPage = 1;
    let largestArea = 0;
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const area = vp.width * vp.height;
      if (area > largestArea) { largestArea = area; largestPage = i; }
      try { await page.cleanup(); } catch {}
    }
    return { pageCount, largestPage };
  } finally {
    try { await doc.destroy(); } catch {}
  }
}

async function renderOne(doc: any, pageNumber: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: SCALE });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  const cc = doc.canvasFactory.create(width, height);
  // White background — PDFs often render on transparent and OCR likes white
  cc.context.fillStyle = "#ffffff";
  cc.context.fillRect(0, 0, width, height);

  await page.render({ canvasContext: cc.context, viewport }).promise;

  const rawPng: Buffer = cc.canvas.toBuffer("image/png");
  doc.canvasFactory.destroy(cc);
  // Re-encode through sharp so downstream tile crops are guaranteed PNG-compatible
  const png = await sharp(rawPng).png({ compressionLevel: 6 }).toBuffer();
  try { await page.cleanup(); } catch {}
  return { pageNumber, width, height, png };
}

export const RENDER_DPI = DPI;
