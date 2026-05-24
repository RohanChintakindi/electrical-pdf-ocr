// Light-weight job read/write helpers. Pulled out of process.ts so API routes
// that only need to read result JSON don't transitively bundle sharp/pdfjs/vision.
import { v4 as uuid } from "uuid";
import { getJson, putJson } from "./blob";
import type { JobResult, PageJobResult } from "./types";

export function jobKey(jobId: string) {
  return `jobs/${jobId}/result.json`;
}

export function pageImageKey(jobId: string, pageNumber: number) {
  return `jobs/${jobId}/page-${pageNumber}.png`;
}

export function pageJobKey(jobId: string, pageNumber: number) {
  return `jobs/${jobId}/page-${pageNumber}.json`;
}

export function newJobId(): string {
  return uuid();
}

export async function readJob(jobId: string): Promise<JobResult | null> {
  return getJson<JobResult>(jobKey(jobId));
}

export async function writeJob(job: JobResult): Promise<void> {
  await putJson(jobKey(job.jobId), job);
}

export async function readPageJob(jobId: string, pageNumber: number): Promise<PageJobResult | null> {
  return getJson<PageJobResult>(pageJobKey(jobId, pageNumber));
}

export async function writePageJob(pj: PageJobResult): Promise<void> {
  await putJson(pageJobKey(pj.jobId, pj.pageNumber), pj);
}
