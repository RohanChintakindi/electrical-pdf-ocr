import { NextRequest, NextResponse } from "next/server";
import { runPipeline, readJob, writeJob } from "@/lib/process";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { jobId, pdfName, pdfPath } = await req.json();
  if (!jobId || !pdfName || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pdfName/pdfPath" }, { status: 400 });
  }
  try {
    const result = await runPipeline({ jobId, pdfName, pdfPath });
    return NextResponse.json({ ok: true, status: result.status, totalHits: result.meta.totalHits });
  } catch (e: any) {
    console.error("[process] fatal:", e);
    const job = await readJob(jobId);
    if (job) {
      job.status = "error";
      job.error = e.message;
      await writeJob(job);
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
