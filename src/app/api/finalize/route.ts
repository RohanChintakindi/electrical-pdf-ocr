// Dedicated finalize endpoint. Fresh 60s budget — owns the Claude verification
// pass which adds ~10-15s. Polls until all pages + legend are settled, then
// runs tryFinalize(runVerify=true). Page workers and /api/result keep their
// inline tryFinalize (no verify) as a fast base-merge safety net, but only
// this endpoint triggers the verify pass so multiple polls don't thrash it.
import { NextResponse } from "next/server";
import { tryFinalize } from "@/lib/finalize";
import { readJob, readLegend, readPageJob } from "@/lib/jobs";

export const runtime = "nodejs";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 55_000; // stay under the 60s function cap

async function pagesSettled(jobId: string): Promise<boolean> {
  const job = await readJob(jobId);
  if (!job) return false;
  const total = job.meta.totalPages;
  if (total <= 0) return false;
  const pjs = await Promise.all(
    Array.from({ length: total }, (_, i) => readPageJob(jobId, i + 1)),
  );
  if (!pjs.every((p) => p !== null && (p.status === "done" || p.status === "error"))) return false;
  const legend = await readLegend(jobId);
  return legend !== null;
}

export async function POST(req: Request) {
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const started = Date.now();
  let settled = false;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    if (await pagesSettled(jobId)) { settled = true; break; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!settled) {
    // Workers will keep finishing; the /api/result lazy fallback will do a
    // base merge once everything lands. Verify just doesn't run this time.
    return NextResponse.json({ ok: false, reason: "pages not settled within budget" }, { status: 202 });
  }
  await tryFinalize(jobId, { runVerify: true });
  return NextResponse.json({ ok: true });
}
