// Legend discovery worker: render the largest page (heuristically the lighting
// plan) and ask Claude to read the legend. Updates the master job with the
// legend, then attempts finalize.
import { getBytes } from "./blob";
import { renderPdfPage } from "./pdf-render";
import { inspectPdfLight } from "./pdf-inspect";
import { discoverLegend } from "./claude-legend";
import { readJob, writeJob } from "./jobs";
import { tryFinalize } from "./finalize";

export interface ProcessLegendInput {
  jobId: string;
  pdfPath: string;
}

export async function processLegend({ jobId, pdfPath }: ProcessLegendInput): Promise<void> {
  try {
    const pdfBytes = await getBytes(pdfPath);
    if (!pdfBytes) throw new Error(`PDF not found at ${pdfPath}`);

    const { largestPage } = await inspectPdfLight(new Uint8Array(pdfBytes));
    const rendered = await renderPdfPage(new Uint8Array(pdfBytes), largestPage);
    const legend = await discoverLegend(rendered.png, rendered.width, rendered.height);
    console.log(`[legend] discovered ${legend.length} codes`);

    const job = await readJob(jobId);
    if (job) {
      job.legend = legend;
      job.legendStatus = "done";
      await writeJob(job);
    }
  } catch (e: any) {
    console.error("[legend] failure, finalizing with regex-only filter:", e);
    const job = await readJob(jobId);
    if (job) {
      job.legend = [];
      job.legendStatus = "error";
      await writeJob(job);
    }
  }
  await tryFinalize(jobId);
}
