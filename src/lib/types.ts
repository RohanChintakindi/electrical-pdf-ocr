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
  /** Pre-legend-filter hits; merged across by finalize. Optional during streaming. */
  rawHits?: RawHit[];
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
  legend?: { code: string; description: string }[];
  legendStatus?: "pending" | "done" | "error";
  error?: string;
}

/** Per-page result blob written by /api/process-page workers. */
export interface PageJobResult {
  jobId: string;
  pageNumber: number;
  width: number;
  height: number;
  imageUrl: string;
  status: "done" | "error";
  rawHits: RawHit[];
  errors?: string[];
  durationMs?: number;
  /** Diagnostics: per-tile word count, errors. Optional. */
  debug?: {
    tileCount: number;
    tilesWithWords: number;
    totalWordsRaw: number;
    sampleWords?: string[];
    tileErrors?: string[];
  };
}

export interface RawHit {
  code: string;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
