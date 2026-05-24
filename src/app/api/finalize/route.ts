// Dedicated finalize endpoint. Fresh function invocation = fresh 60s budget,
// avoids the case where the orchestrator's inline tryFinalize gets killed at
// the function cap before the master write lands.
import { NextResponse } from "next/server";
import { tryFinalize } from "@/lib/finalize";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { jobId } = (await req.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  await tryFinalize(jobId);
  return NextResponse.json({ ok: true });
}
