// Lightweight PDF inspection via pdf-lib only (no pdfjs/canvas/sharp).
// Used by the orchestrator so its bundle stays small and cold-start is fast.
import { PDFDocument } from "pdf-lib";

export async function inspectPdfLight(pdfBytes: Uint8Array): Promise<{
  pageCount: number;
  largestPage: number;
}> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const pages = doc.getPages();
  let largestPage = 1;
  let largestArea = 0;
  pages.forEach((p, i) => {
    const { width, height } = p.getSize();
    const area = width * height;
    if (area > largestArea) {
      largestArea = area;
      largestPage = i + 1;
    }
  });
  return { pageCount: pages.length, largestPage };
}
