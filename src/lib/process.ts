// Orchestrates the full pipeline for one PDF.
// 1. Render every page → PNG
// 2. Run legend discovery on the largest page (heuristic)
// 3. For each page (max 3 concurrent), tile → OCR each tile (max 5 concurrent) →
//    merge adjacent suffixes → dedupe → filter by legend.
// 4. Stream progress by re-writing the result JSON after each page completes.
import { getBytes, putBytes } from "./blob";
import { renderPdfPages } from "./pdf-render";
import { tilePage } from "./tile";
import { ocrTile, ensureCredsFileFromEnv } from "./google-vision";
import { discoverLegend } from "./claude-legend";
import { mergeAdjacentSuffixes, dedupeOverlaps, filterByLegend } from "./dedupe";
import { colorForCode } from "./colors";
import type { JobResult, PageResult, RawHit, CodeEntry, Instance } from "./types";
import { pMap } from "./concurrency";
import { readJob, writeJob, pageImageKey } from "./jobs";

const MAX_PAGES_IN_FLIGHT = 3;
const MAX_TILES_IN_FLIGHT = 5;

export interface ProcessOptions {
  jobId: string;
  pdfName: string;
  pdfPath: string;
}

export async function runPipeline({ jobId, pdfName, pdfPath }: ProcessOptions): Promise<JobResult> {
  ensureCredsFileFromEnv();
  const started = Date.now();

  // Initial stub already exists (written by /api/upload). Re-read so we have any
  // metadata the upload route set.
  let job: JobResult = (await readJob(jobId)) ?? {
    jobId,
    status: "processing",
    pdfName,
    pdfUrl: pdfPath,
    processedAt: new Date().toISOString(),
    ocrEngine: "google-vision",
    meta: { totalPages: 0, totalHits: 0 },
    pages: [],
    codes: [],
  };
  job.status = "processing";
  await writeJob(job);

  // ---- 1. Render ----
  const pdfBytes = await getBytes(pdfPath);
  if (!pdfBytes) {
    job.status = "error";
    job.error = `PDF not found at ${pdfPath}`;
    await writeJob(job);
    return job;
  }
  let rendered;
  try {
    rendered = await renderPdfPages(new Uint8Array(pdfBytes));
  } catch (e: any) {
    job.status = "error";
    job.error = `Failed to render PDF: ${e.message}`;
    await writeJob(job);
    return job;
  }

  // Persist page images + initial page records
  job.meta.totalPages = rendered.length;
  job.pages = await Promise.all(
    rendered.map(async (rp): Promise<PageResult> => {
      const written = await putBytes(pageImageKey(jobId, rp.pageNumber), rp.png, "image/png");
      return {
        pageNumber: rp.pageNumber,
        width: rp.width,
        height: rp.height,
        imageUrl: written.url,
        status: "pending",
        instances: [],
      };
    }),
  );
  await writeJob(job);

  // ---- 2. Legend discovery on largest page (likely the lighting plan w/ legend) ----
  let legend: { code: string; description: string }[] = [];
  try {
    const largest = rendered.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    legend = await discoverLegend(largest.png, largest.width, largest.height);
  } catch (e) {
    console.error("[legend] failure, continuing with regex-only filter:", e);
  }
  console.log(`[legend] discovered ${legend.length} codes`);

  // ---- 3. Process each page ----
  await pMap(rendered, MAX_PAGES_IN_FLIGHT, async (rp) => {
    const idx = job.pages.findIndex((p) => p.pageNumber === rp.pageNumber);
    job.pages[idx].status = "processing";
    await writeJob(job);

    try {
      const tiles = await tilePage(rp.png, rp.width, rp.height);
      const tileHits = await pMap(tiles, MAX_TILES_IN_FLIGHT, async (t) => {
        try {
          return await ocrTile(t.png, t.x, t.y);
        } catch (e: any) {
          console.error(`[ocr] page ${rp.pageNumber} tile ${t.x},${t.y} failed:`, e.message);
          return [] as RawHit[];
        }
      });
      const allRaw: RawHit[] = tileHits.flat();
      const merged = mergeAdjacentSuffixes(allRaw);
      const deduped = dedupeOverlaps(merged);
      const legendCodes = legend.map((l) => l.code);
      const instances = filterByLegend(deduped, legendCodes);
      job.pages[idx].instances = instances;
      job.pages[idx].status = "done";
    } catch (e: any) {
      job.pages[idx].status = "error";
      job.pages[idx].errors = [e.message];
    }
    await writeJob(job);
  });

  // ---- 4. Roll up codes ----
  const counts = new Map<string, number>();
  for (const p of job.pages) {
    for (const inst of p.instances) {
      counts.set(inst.code, (counts.get(inst.code) ?? 0) + 1);
    }
  }
  const descByCode = new Map(legend.map((l) => [l.code.toUpperCase(), l.description] as const));
  const codes: CodeEntry[] = [...counts.entries()]
    .sort((a, b) => smartSort(a[0], b[0]))
    .map(([code, count]) => ({
      code,
      description: descByCode.get(code.toUpperCase()) ?? "",
      count,
      color: colorForCode(code),
    }));
  job.codes = codes;
  job.meta.totalHits = codes.reduce((s, c) => s + c.count, 0);
  job.meta.durationMs = Date.now() - started;
  job.status = job.pages.some((p) => p.status === "error") ? "partial" : "complete";
  await writeJob(job);
  return job;
}

function smartSort(a: string, b: string): number {
  const re = /^([A-Z]+)(\d+)(-?.*)$/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (ma && mb && ma[1] === mb[1]) {
    const na = parseInt(ma[2], 10);
    const nb = parseInt(mb[2], 10);
    if (na !== nb) return na - nb;
    return ma[3].localeCompare(mb[3]);
  }
  return a.localeCompare(b);
}
