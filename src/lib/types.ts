export type JobStatus = "queued" | "processing" | "complete" | "partial" | "error";
export type PageStatus = "pending" | "processing" | "done" | "error";

export interface Instance {
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

export interface PageResult {
  pageNumber: number;
  width: number;
  height: number;
  imageUrl: string;
  status: PageStatus;
  instances: Instance[];
  errors?: string[];
}

export interface CodeEntry {
  code: string;
  description: string;
  count: number;
  color: string;
}

export interface JobResult {
  jobId: string;
  status: JobStatus;
  pdfName: string;
  pdfUrl: string;
  processedAt: string;
  ocrEngine: "google-vision";
  meta: {
    totalPages: number;
    totalHits: number;
    durationMs?: number;
  };
  pages: PageResult[];
  codes: CodeEntry[];
  error?: string;
}

export interface RawHit {
  code: string;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
