// Self-contained per-page worker: download PDF, render ONE page, OCR, save
// per-page result blob, attempt finalize. Fits in Vercel Hobby's 60s.
import { getBytes, putBytes } from "./blob";
import { renderPdfPage } from "./pdf-render";
import { tilePage } from "./tile";
import { ocrTile, ensureCredsFileFromEnv } from "./google-vision";
import { mergeAdjacentSuffixes, dedupeOverlaps } from "./dedupe";
import { pMap } from "./concurrency";
import { pageImageKey, writePageJob } from "./jobs";
import { tryFinalize } from "./finalize";
import type { RawHit } from "./types";

const MAX_TILES_IN_FLIGHT = 5;

export interface ProcessPageInput {
  jobId: string;
  pageNumber: number;
  pdfPath: string;
}

export async function processOnePage({ jobId, pageNumber, pdfPath }: ProcessPageInput): Promise<void> {
  const started = Date.now();
  try {
    ensureCredsFileFromEnv();
    const pdfBytes = await getBytes(pdfPath);
    if (!pdfBytes) throw new Error(`PDF not found at ${pdfPath}`);

    const rp = await renderPdfPage(new Uint8Array(pdfBytes), pageNumber);
    const writtenImg = await putBytes(pageImageKey(jobId, pageNumber), rp.png, "image/png");

    const tiles = await tilePage(rp.png, rp.width, rp.height);
    const tileHits = await pMap(tiles, MAX_TILES_IN_FLIGHT, async (t) => {
      try {
        return await ocrTile(t.png, t.x, t.y);
      } catch (e: any) {
        console.error(`[ocr] page ${pageNumber} tile ${t.x},${t.y} failed:`, e.message);
        return [] as RawHit[];
      }
    });
    const allRaw: RawHit[] = tileHits.flat();
    const merged = mergeAdjacentSuffixes(allRaw);
    const deduped = dedupeOverlaps(merged);

    await writePageJob({
      jobId,
      pageNumber,
      width: rp.width,
      height: rp.height,
      imageUrl: writtenImg.url,
      status: "done",
      rawHits: deduped,
      durationMs: Date.now() - started,
    });
  } catch (e: any) {
    console.error(`[process-page] page ${pageNumber} failed:`, e);
    await writePageJob({
      jobId,
      pageNumber,
      width: 0,
      height: 0,
      imageUrl: "",
      status: "error",
      rawHits: [],
      errors: [e.message],
      durationMs: Date.now() - started,
    });
  }
  await tryFinalize(jobId);
}
