// Legend discovery worker. Writes to a dedicated jobs/X/legend.json blob so
// it never races with orchestrator/finalize writes to the master result.json.
import { getBytes } from "./blob";
import { renderPdfPage } from "./pdf-render";
import { inspectPdfLight } from "./pdf-inspect";
import { discoverLegend } from "./claude-legend";
import { writeLegend } from "./jobs";
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
    const codes = await discoverLegend(rendered.png, rendered.width, rendered.height);
    console.log(`[legend] discovered ${codes.length} codes`);

    await writeLegend(jobId, { status: "done", codes });
  } catch (e: any) {
    console.error("[legend] failure, finalizing with regex-only filter:", e);
    await writeLegend(jobId, { status: "error", codes: [], error: e.message });
  }
  await tryFinalize(jobId);
}
