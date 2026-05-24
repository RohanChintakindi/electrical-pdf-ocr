import { NextResponse } from "next/server";
import { readJob, readLegend, readPageJob, writeLegend } from "@/lib/jobs";
import { tryFinalize } from "@/lib/finalize";

export const runtime = "nodejs";

// If all pages settle but legend is still missing past this many ms after
// the orchestrator wrote the master, assume the legend worker died and
// synthesize an empty one so finalize can proceed (regex-only filter).
const LEGEND_GIVEUP_MS = 90_000;

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  let job = await readJob(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Once finalize has merged everything, master is authoritative.
  if (job.status === "complete" || job.status === "partial" || job.status === "error") {
    return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
  }

  // Overlay per-page blobs so the UI sees pages flip to "done" as each
  // worker finishes (instead of waiting for finalize).
  const overlays = await Promise.all(
    job.pages.map((p) => readPageJob(jobId, p.pageNumber)),
  );

  // Safety net: workers + orchestrator both call tryFinalize, but the LAST
  // caller is the one with real work to do — and it's the most-loaded, so
  // it tends to die at the 60s function cap before the master write lands.
  // This polling endpoint is a fresh invocation with its own budget, so
  // call tryFinalize here when conditions are met. It's idempotent.
  const allPagesSettled = overlays.every((pj) => pj !== null);
  if (allPagesSettled) {
    // If pages are done but legend never showed, give it a deadline then
    // synthesize an empty legend so finalize can complete (regex-only filter).
    const legend = await readLegend(jobId);
    if (!legend) {
      const elapsed = Date.now() - new Date(job.processedAt).getTime();
      if (elapsed > LEGEND_GIVEUP_MS) {
        await writeLegend(jobId, { status: "error", codes: [], error: "legend worker timed out" });
      }
    }
    await tryFinalize(jobId);
    const refreshed = await readJob(jobId);
    if (refreshed && refreshed.status !== "processing" && refreshed.status !== "queued") {
      return NextResponse.json(refreshed, { headers: { "cache-control": "no-store" } });
    }
    if (refreshed) job = refreshed;
  }

  job.pages = job.pages.map((p, i) => {
    const pj = overlays[i];
    if (!pj) return p;
    return {
      ...p,
      width: pj.width || p.width,
      height: pj.height || p.height,
      imageUrl: pj.imageUrl || p.imageUrl,
      status: pj.status,
      errors: pj.errors,
    };
  });
  return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
}
