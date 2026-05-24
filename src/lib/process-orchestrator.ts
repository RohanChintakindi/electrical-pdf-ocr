// Orchestrator: download PDF, count pages, seed the master result.json with
// page stubs, fire fire-and-forget POSTs to per-page + legend workers. Returns
// fast (~3-5 s) — actual work runs in parallel across N+1 invocations.
import { getBytes } from "./blob";
import { inspectPdfLight } from "./pdf-inspect";
import { readJob, writeJob } from "./jobs";
import { tryFinalize } from "./finalize";
import type { JobResult, PageResult } from "./types";

export interface OrchestrateInput {
  jobId: string;
  pdfName: string;
  pdfPath: string;
  /** Public base URL for cross-function POSTs. Detected from VERCEL_URL when unset. */
  baseUrl?: string;
}

function resolveBaseUrl(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, "");
  // VERCEL_PROJECT_PRODUCTION_URL is the stable production alias; VERCEL_URL is per-deploy.
  // Either works for in-cluster calls.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function orchestrate({ jobId, pdfName, pdfPath, baseUrl }: OrchestrateInput): Promise<{ totalPages: number }> {
  const pdfBytes = await getBytes(pdfPath);
  if (!pdfBytes) throw new Error(`PDF not found at ${pdfPath}`);
  const { pageCount } = await inspectPdfLight(new Uint8Array(pdfBytes));

  // Seed master with N page stubs + processing status
  const existing = await readJob(jobId);
  const pages: PageResult[] = Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1,
    width: 0,
    height: 0,
    imageUrl: "",
    status: "pending",
    instances: [],
  }));
  const job: JobResult = {
    jobId,
    status: "processing",
    pdfName: existing?.pdfName ?? pdfName,
    pdfUrl: existing?.pdfUrl ?? pdfPath,
    processedAt: new Date().toISOString(),
    ocrEngine: "google-vision",
    meta: { totalPages: pageCount, totalHits: 0 },
    pages,
    codes: [],
    legendStatus: "pending",
  };
  await writeJob(job);

  // Fire workers — await the POSTs (kickoff returns ~instantly via waitUntil
  // on the receiving end) so we know they were actually sent before this
  // function exits.
  const base = resolveBaseUrl(baseUrl);
  const headers = { "content-type": "application/json" };
  const tasks: Promise<unknown>[] = [];
  for (let i = 1; i <= pageCount; i++) {
    tasks.push(
      fetch(`${base}/api/process-page`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId, pageNumber: i, pdfPath }),
      }).catch((e) => console.error(`[orchestrator] page ${i} kickoff failed:`, e.message)),
    );
  }
  tasks.push(
    fetch(`${base}/api/process-legend`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId, pdfPath }),
    }).catch((e) => console.error("[orchestrator] legend kickoff failed:", e.message)),
  );
  await Promise.all(tasks);

  // Defensive: workers each call tryFinalize after their write, but if the
  // last one was killed mid-call (hitting the 60s function cap) finalize
  // never runs. Now that all worker fetches have returned, the orchestrator
  // does the final flush itself.
  await tryFinalize(jobId);

  return { totalPages: pageCount };
}
