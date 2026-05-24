import { NextResponse } from "next/server";
import { readJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const safeName = job.pdfName.replace(/\.pdf$/i, "");
  return new NextResponse(JSON.stringify(job, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${safeName}-ocr.json"`,
    },
  });
}
