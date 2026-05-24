import { NextRequest, NextResponse } from "next/server";
import { orchestrate } from "@/lib/process-orchestrator";
import { readJob, writeJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { jobId, pdfName, pdfPath } = await req.json();
  if (!jobId || !pdfName || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pdfName/pdfPath" }, { status: 400 });
  }
  // We await orchestrate inline (no waitUntil) because @vercel/functions'
  // waitUntil is a no-op on Node runtime — the promise gets dropped. The
  // orchestrator fires N+1 parallel POSTs to /api/process-page and
  // /api/process-legend; total wall time ≈ max(per-page run) ≈ 40-50s.
  // Browser fires /api/process fire-and-forget, so the long wait is fine.
  try {
    const { totalPages } = await orchestrate({ jobId, pdfName, pdfPath });
    return NextResponse.json({ ok: true, totalPages });
  } catch (e: any) {
    console.error("[process] orchestrate failed:", e);
    const job = await readJob(jobId);
    if (job) {
      job.status = "error";
      job.error = e.message;
      await writeJob(job);
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
