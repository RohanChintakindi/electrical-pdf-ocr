import { NextResponse } from "next/server";
import { readJob, readPageJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Once finalize has merged everything, master is authoritative.
  if (job.status === "complete" || job.status === "partial" || job.status === "error") {
    return NextResponse.json(job, { headers: { "cache-control": "no-store" } });
  }

  // Otherwise, overlay per-page blobs so the UI can show pages flipping to
  // "done" as each worker finishes (instead of waiting for finalize).
  const overlays = await Promise.all(
    job.pages.map((p) => readPageJob(jobId, p.pageNumber)),
  );
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
