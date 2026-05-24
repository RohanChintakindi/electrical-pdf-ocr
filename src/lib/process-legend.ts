// Legend discovery worker. Writes to a dedicated jobs/X/legend.json blob so
// it never races with orchestrator/finalize writes to the master result.json.
//
// Strategy: the "largest page" heuristic was unreliable (all pages are the
// same dims on Jesse's PDF, so it picked page 1 = Notes instead of page 2 =
// lighting plan with the actual legend). Now we render and ask Claude about
// every page, then merge. Each call returns [] for non-legend pages, so
// merging is safe.
import { getBytes } from "./blob";
import { renderPdfPageLowRes } from "./pdf-render";
import { inspectPdfLight } from "./pdf-inspect";
import { discoverLegend, type LegendEntry } from "./claude-legend";
import { writeLegend } from "./jobs";
import { tryFinalize } from "./finalize";
import { pMap } from "./concurrency";

export interface ProcessLegendInput {
  jobId: string;
  pdfPath: string;
}

const RENDER_CONCURRENCY = 2;
const CLAUDE_CONCURRENCY = 4;

export async function processLegend({ jobId, pdfPath }: ProcessLegendInput): Promise<void> {
  try {
    const pdfBytes = await getBytes(pdfPath);
    if (!pdfBytes) throw new Error(`PDF not found at ${pdfPath}`);

    const { pageCount } = await inspectPdfLight(new Uint8Array(pdfBytes));
    const pageNumbers = Array.from({ length: pageCount }, (_, i) => i + 1);

    // Low-DPI is fine for Claude vision — it's ~10x faster than the OCR render.
    const rendered = await pMap(pageNumbers, RENDER_CONCURRENCY, (pn) =>
      renderPdfPageLowRes(new Uint8Array(pdfBytes), pn).then((r) => ({ pn, ...r })),
    );

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
