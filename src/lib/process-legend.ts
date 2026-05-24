// Legend discovery worker. Writes to a dedicated jobs/X/legend.json blob so
// it never races with orchestrator/finalize writes to the master result.json.
//
// Strategy: render every page at low DPI (or reuse the OCR worker's page
// renders when they're already in Blob), ask Claude about each, merge.
// Each call returns [] for non-legend pages, so merging is safe.
import { getBytes } from "./blob";
import { renderPdfPageLowRes } from "./pdf-render";
import { inspectPdfLight } from "./pdf-inspect";
import { discoverLegend, type LegendEntry } from "./claude-legend";
import { pageImageKey, writeLegend } from "./jobs";
import { tryFinalize } from "./finalize";
import { pMap } from "./concurrency";
import sharp from "sharp";

export interface ProcessLegendInput {
  jobId: string;
  pdfPath: string;
}

const RENDER_CONCURRENCY = 2;
const CLAUDE_CONCURRENCY = 4;

/** Try to fetch an OCR-worker-rendered page PNG from Blob. Returns null if
 * not yet written or not reachable. Saves us from re-rendering the page. */
async function fetchOcrPageImage(jobId: string, pageNumber: number): Promise<Buffer | null> {
  const { urlFor } = await import("./blob");
  const url = urlFor(pageImageKey(jobId, pageNumber));
  if (!url) return null;
  try {
    const r = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function downsizeForClaude(png: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const img = sharp(png);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const MAX = 3072;
  if (Math.max(w, h) <= MAX) return { png, width: w, height: h };
  const resize = w >= h ? { width: MAX } : { height: MAX };
  const out = await img.resize({ ...resize, withoutEnlargement: true }).png().toBuffer();
  const m2 = await sharp(out).metadata();
  return { png: out, width: m2.width ?? 0, height: m2.height ?? 0 };
}

export async function processLegend({ jobId, pdfPath }: ProcessLegendInput): Promise<void> {
  try {
    const pdfBytes = await getBytes(pdfPath);
    if (!pdfBytes) throw new Error(`PDF not found at ${pdfPath}`);

    const { pageCount } = await inspectPdfLight(new Uint8Array(pdfBytes));
    const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

    // Try to reuse the OCR worker's already-rendered page PNGs. Only fall back
    // to a low-DPI re-render if the OCR blob isn't there yet (legend worker
    // started before / faster than the corresponding page worker).
    const rendered = await pMap(pageNumbers, RENDER_CONCURRENCY, async (pn) => {
      const existing = await fetchOcrPageImage(jobId, pn);
      if (existing) {
        const r = await downsizeForClaude(existing);
        return { pn, ...r };
      }
      const r = await renderPdfPageLowRes(new Uint8Array(pdfBytes), pn);
      return { pn, ...r };
    });

    const perPageCodes = await pMap(rendered, CLAUDE_CONCURRENCY, async (r) => {
      try {
        const codes = await discoverLegend(r.png, r.width, r.height);
        console.log(`[legend] page ${r.pn}: ${codes.length} codes`);
        return codes;
      } catch (e: any) {
        console.error(`[legend] page ${r.pn} failed:`, e.message);
        return [] as LegendEntry[];
      }
    });

    const byCode = new Map<string, LegendEntry>();
    for (const codes of perPageCodes) {
      for (const c of codes) {
        const key = c.code.trim().toUpperCase();
        if (!key) continue;
        const existing = byCode.get(key);
        // Prefer the longer/more-informative description when duplicates appear
        if (!existing || (c.description?.length ?? 0) > (existing.description?.length ?? 0)) {
          byCode.set(key, { code: c.code.trim(), description: c.description ?? "" });
        }
      }
    }
    const merged = [...byCode.values()];
    console.log(`[legend] merged total: ${merged.length} unique codes`);

    await writeLegend(jobId, { status: "done", codes: merged });
  } catch (e: any) {
    console.error("[legend] failure, finalizing with regex-only filter:", e);
    await writeLegend(jobId, { status: "error", codes: [], error: e.message });
  }
  await tryFinalize(jobId);
}
