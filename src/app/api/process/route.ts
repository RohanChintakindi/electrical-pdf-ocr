import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { orchestrate } from "@/lib/process-orchestrator";
import { readJob, writeJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { jobId, pdfName, pdfPath } = await req.json();
  if (!jobId || !pdfName || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pdfName/pdfPath" }, { status: 400 });
  }
  // Run orchestrator in waitUntil so the kickoff response returns immediately.
  // The orchestrator inspects the PDF (~2s), seeds N page stubs, and fires
  // POSTs to /api/process-page and /api/process-legend in parallel.
  waitUntil(
    (async () => {
      try {
        await orchestrate({ jobId, pdfName, pdfPath });
      } catch (e: any) {
        console.error("[process] orchestrate failed:", e);
        const job = await readJob(jobId);
        if (job) {
          job.status = "error";
          job.error = e.message;
          await writeJob(job);
        }
      }
    })(),
  );
  return NextResponse.json({ ok: true });
}
