// Race-tolerant finalize: when ALL per-page workers + legend worker are done,
// merge their outputs into the master result.json with the final code rollup.
// Multiple workers may call this concurrently; the write is idempotent so the
// last write wins with the same content.
import { readJob, readLegend, readPageJob, writeJob } from "./jobs";
import { filterByLegend } from "./dedupe";
import { colorForCode } from "./colors";
import type { CodeEntry, JobResult, PageResult } from "./types";

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

export async function tryFinalize(jobId: string): Promise<void> {
  const job = await readJob(jobId);
  if (!job) return;
  if (job.status === "complete" || job.status === "partial" || job.status === "error") return;

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
