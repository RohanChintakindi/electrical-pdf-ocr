// Direct-to-Blob upload. The browser uploads the PDF straight to Vercel Blob;
// this route only mints a one-shot upload token, then (in onUploadCompleted)
// initialises the result.json stub + kicks off /api/process.
//
// Local dev (no BLOB_READ_WRITE_TOKEN): falls through to a tiny multipart
// fallback that writes to .local-blob/ via lib/blob.ts.
import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { putBytes, putJson } from "@/lib/blob";
import { newJobId } from "@/lib/jobs";
import type { JobResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

async function writeStub(jobId: string, pdfName: string, pdfPath: string) {
  const stub: JobResult = {
    jobId,
    status: "queued",
    pdfName,
    pdfUrl: pdfPath,
    processedAt: new Date().toISOString(),
    ocrEngine: "google-vision",
    meta: { totalPages: 0, totalHits: 0 },
    pages: [],
    codes: [],
  };
  await putJson(`jobs/${jobId}/result.json`, stub);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

  if (hasBlob) {
    // Production / Vercel: client uses @vercel/blob/client `upload()` which
    // POSTs this route twice (generate-token, then upload-completed).
    const body = (await req.json()) as HandleUploadBody;
    try {
      const json = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayloadStr) => {
          let payload: { pdfName?: string; jobId?: string } = {};
          try { payload = JSON.parse(clientPayloadStr ?? "{}"); } catch {}
          const jobId = payload.jobId ?? newJobId();
          const pdfName = payload.pdfName ?? pathname.split("/").pop() ?? "upload.pdf";
          return {
            allowedContentTypes: ["application/pdf"],
            maximumSizeInBytes: MAX_BYTES,
            tokenPayload: JSON.stringify({ jobId, pdfName }),
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          try {
            const { jobId, pdfName } = JSON.parse(tokenPayload ?? "{}") as { jobId: string; pdfName: string };
            await writeStub(jobId, pdfName, blob.url);
            // The browser kicks off /api/process after this — fire-and-forget
            // from inside a serverless function gets killed when the function
            // exits.
          } catch (e) {
            console.error("[upload] onUploadCompleted failed:", e);
          }
        },
      });
      return NextResponse.json(json);
    } catch (e: any) {
      console.error("[upload] handleUpload error:", e);
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
  }

  // Local dev: classic multipart upload (no Blob token configured)
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (max 50 MB)` }, { status: 413 });
    if (!/\.pdf$/i.test(file.name)) return NextResponse.json({ error: "Only .pdf files are accepted" }, { status: 400 });

    const jobId = newJobId();
    const buf = Buffer.from(await file.arrayBuffer());
    const pdfPathname = `jobs/${jobId}/source.pdf`;
    await putBytes(pdfPathname, buf, "application/pdf");
    await writeStub(jobId, file.name, pdfPathname);
    // Browser kicks off /api/process — fire-and-forget from a serverless
    // function gets killed when the function exits.
    return NextResponse.json({ jobId, pdfPath: pdfPathname, pdfName: file.name }, { status: 200 });
  } catch (e: any) {
    console.error("[upload] error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
