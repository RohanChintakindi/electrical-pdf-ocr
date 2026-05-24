import { notFound } from "next/navigation";
import { readJob } from "@/lib/jobs";
import ResultsViewer from "@/components/ResultsViewer";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job) notFound();
  return <ResultsViewer initial={job} />;
}
