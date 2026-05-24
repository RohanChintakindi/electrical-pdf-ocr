import { NextRequest, NextResponse } from "next/server";
import { putBytes, putJson } from "@/lib/blob";
import { newJobId } from "@/lib/process";
import type { JobResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max 50 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, { status: 413 });
    }
    if (!/\.pdf$/i.test(file.name)) {
      return NextResponse.json({ error: "Only .pdf files are accepted" }, { status: 400 });
    }

    const jobId = newJobId();
    const buf = Buffer.from(await file.arrayBuffer());
    const pdfPathname = `jobs/${jobId}/source.pdf`;
    await putBytes(pdfPathname, buf, "application/pdf");

    const stub: JobResult = {
      jobId,
      status: "queued",
      pdfName: file.name,
      pdfUrl: pdfPathname,
      processedAt: new Date().toISOString(),
      ocrEngine: "google-vision",
      meta: { totalPages: 0, totalHits: 0 },
      pages: [],
      codes: [],
    };
    await putJson(`jobs/${jobId}/result.json`, stub);

    // Kick off processing. Fire-and-forget; the worker keeps writing back to blob.
    const origin = req.nextUrl.origin;
    fetch(`${origin}/api/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, pdfName: file.name, pdfPath: pdfPathname }),
    }).catch((e) => console.error("[upload] kickoff fetch failed:", e));

    return NextResponse.json({ jobId }, { status: 200 });
  } catch (e: any) {
    console.error("[upload] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
