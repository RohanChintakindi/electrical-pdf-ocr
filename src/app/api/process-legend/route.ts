import { NextRequest, NextResponse } from "next/server";
import { processLegend } from "@/lib/process-legend";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { jobId, pdfPath } = await req.json();
  if (!jobId || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pdfPath" }, { status: 400 });
  }
  await processLegend({ jobId, pdfPath });
  return NextResponse.json({ ok: true });
}
