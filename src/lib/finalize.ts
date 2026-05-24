// Race-tolerant finalize: when ALL per-page workers + legend worker are done,
// merge their outputs into the master result.json with the final code rollup.
// Multiple workers may call this concurrently; the write is idempotent so the
// last write wins with the same content.
import { getBytes } from "./blob";
import { readJob, readLegend, readPageJob, writeJob, pageImageKey } from "./jobs";
import { filterByLegend, buildLegendResolver } from "./dedupe";
import { verifyPage } from "./claude-verify";
import { colorForCode } from "./colors";
import { pMap } from "./concurrency";
import type { CodeEntry, Instance, JobResult, PageResult } from "./types";

// Turn this off via env to skip the extra Claude pass (saves ~10s + API spend)
const VERIFY_ENABLED = process.env.OCR_VERIFY_DISABLED !== "1";
// One concurrent Claude call per page — keeps wall time flat regardless of
// fixture-page count, bounded by API rate limits.
const VERIFY_CONCURRENCY = 7;
// Pages with very few base detections are almost always text-only sheets
// (specifications, notes, schematics). Running verify on those produces
// false-positive hallucinations because Claude tries to find fixtures in
// boilerplate text. Skip unless the page looks like a real plan.
const VERIFY_MIN_HITS = 5;

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

// runVerify gates the expensive Claude verification pass. Only the dedicated
// /api/finalize endpoint passes true (fresh 60s budget). Page workers and the
// /api/result polling fallback pass false (default) so they don't block
// behind 10-15s Claude calls and thrash the polling loop.
export async function tryFinalize(jobId: string, opts: { runVerify?: boolean } = {}): Promise<void> {
  const runVerify = opts.runVerify ?? false;
  const job = await readJob(jobId);
  if (!job) return;
  // Normally a settled job is terminal. But runVerify=true is allowed to
  // re-finalize because /api/result may have already written a base-only
  // master before the orchestrator's /api/finalize call lands.
  if (!runVerify && (job.status === "complete" || job.status === "partial" || job.status === "error")) return;
  if (runVerify && job.status === "error") return;

  const totalPages = job.meta.totalPages;
  if (totalPages <= 0) return;

  // Need every per-page blob settled + legend resolved
  const [pageJobs, legend] = await Promise.all([
    Promise.all(Array.from({ length: totalPages }, (_, i) => readPageJob(jobId, i + 1))),
    readLegend(jobId),
  ]);
  // A page blob now also exists in "processing" state (interim stub for UI
  // progress). Only treat done/error as actually settled.
  const allPagesSettled = pageJobs.every((pj) => pj !== null && (pj.status === "done" || pj.status === "error"));
  const legendReady = legend !== null;
  if (!allPagesSettled || !legendReady) return;

  const legendCodes = legend.codes.map((l) => l.code);
  const merged: PageResult[] = pageJobs.map((pj, i) => {
    const stub = job.pages[i];
    if (!pj) return stub;
    return {
      pageNumber: pj.pageNumber,
      width: pj.width || stub?.width || 0,
      height: pj.height || stub?.height || 0,
      imageUrl: pj.imageUrl || stub?.imageUrl || "",
      status: pj.status,
      instances: filterByLegend(pj.rawHits, legendCodes),
      errors: pj.errors,
    };
  });

  // Verification pass: ask Claude to find labels Vision missed. Only on pages
  // that already have at least one detection (others are non-fixture sheets:
  // notes, schematics, title pages). Runs in parallel; failure is non-fatal.
  let verifyAdded = 0;
  let verifyDurationMs = 0;
  if (runVerify && VERIFY_ENABLED && legendCodes.length > 0) {
    const { resolve } = buildLegendResolver(legendCodes);
    const verifyStart = Date.now();
    const verifyTargets = merged.filter((p) => p.instances.length >= VERIFY_MIN_HITS && p.imageUrl);
    const verifyResults = await pMap(verifyTargets, VERIFY_CONCURRENCY, async (page) => {
      try {
        const pageBuf = await getBytes(pageImageKey(jobId, page.pageNumber));
        if (!pageBuf) return { page: page.pageNumber, added: [] as Instance[] };
        const result = await verifyPage({
          pageBuf,
          pageW: page.width,
          pageH: page.height,
          legendCodes: legend.codes,
          detected: page.instances,
          resolveCode: resolve,
        });
        if (result.error) console.warn(`[finalize] verify page ${page.pageNumber} soft-fail:`, result.error);
        return { page: page.pageNumber, added: result.added };
      } catch (e: any) {
        console.warn(`[finalize] verify page ${page.pageNumber} threw:`, e?.message ?? e);
        return { page: page.pageNumber, added: [] as Instance[] };
      }
    });
    const addedByPage = new Map(verifyResults.map((r) => [r.page, r.added]));
    for (const page of merged) {
      const extra = addedByPage.get(page.pageNumber);
      if (extra && extra.length > 0) {
        page.instances = [...page.instances, ...extra];
        verifyAdded += extra.length;
      }
    }
    verifyDurationMs = Date.now() - verifyStart;
    console.log(`[finalize] verify added ${verifyAdded} hits across ${verifyTargets.length} pages in ${verifyDurationMs}ms`);
  }

  const counts = new Map<string, number>();
  for (const p of merged) {
    for (const inst of p.instances) {
      counts.set(inst.code, (counts.get(inst.code) ?? 0) + 1);
    }
  }
  const descByCode = new Map(legend.codes.map((l) => [l.code.toUpperCase(), l.description] as const));
  const codes: CodeEntry[] = [...counts.entries()]
    .sort((a, b) => smartSort(a[0], b[0]))
    .map(([code, count]) => ({
      code,
      description: descByCode.get(code.toUpperCase()) ?? "",
      count,
      color: colorForCode(code),
    }));

  const final: JobResult = {
    ...job,
    pages: merged,
    codes,
    legend: legend.codes,
    legendStatus: legend.status,
    meta: {
      ...job.meta,
      totalHits: codes.reduce((s, c) => s + c.count, 0),
      durationMs: Date.now() - new Date(job.processedAt).getTime(),
    },
    status: merged.some((p) => p.status === "error") ? "partial" : "complete",
  };
  await writeJob(final);
}
