import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { processOnePage } from "@/lib/process-page";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { jobId, pageNumber, pdfPath } = await req.json();
  if (!jobId || !pageNumber || !pdfPath) {
    return NextResponse.json({ error: "Missing jobId/pageNumber/pdfPath" }, { status: 400 });
  }
  // Return immediately; do the heavy work in waitUntil so the orchestrator's
  // POST resolves fast and the next kickoff can fire.
  waitUntil(processOnePage({ jobId, pageNumber, pdfPath }));
  return NextResponse.json({ ok: true, pageNumber }, { status: 202 });
}
