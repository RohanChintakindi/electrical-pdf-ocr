import { readJob } from "@/lib/jobs";
import ResultsViewer from "@/components/ResultsViewer";
import type { JobResult } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  // Race-tolerant: if the stub isn't written yet (upload just finished, browser
  // navigated faster than the blob write), render a queued placeholder and let
  // the client poll until the real result.json appears.
  const job: JobResult = (await readJob(jobId)) ?? {
    jobId,
    status: "queued",
    pdfName: "uploading…",
    pdfUrl: "",
    processedAt: new Date().toISOString(),
    ocrEngine: "google-vision",
    meta: { totalPages: 0, totalHits: 0 },
    pages: [],
    codes: [],
  };
  return <ResultsViewer initial={job} />;
}
