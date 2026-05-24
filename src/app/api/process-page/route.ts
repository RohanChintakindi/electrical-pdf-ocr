import { NextRequest, NextResponse } from "next/server";
import { processOnePage } from "@/lib/process-page";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { jobId, pageNumber, pdfPath } = await req.json();
  if (!jobId || !pageNumber || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pageNumber/pdfPath" }, { status: 400 });
  }
  // Run the work inline. Browser/orchestrator awaits this response, so it
  // takes ~30-45s for the heavy lighting plan page. waitUntil from
  // @vercel/functions is a no-op on Node runtime so it can't be used.
  await processOnePage({ jobId, pageNumber, pdfPath });
  return NextResponse.json({ ok: true, pageNumber });
}
