"use client";
import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { v4 as uuid } from "uuid";
import { cn } from "@/lib/cn";
import { FileText, ArrowUpRight } from "lucide-react";

interface RecentUpload {
  jobId: string;
  pdfName: string;
  uploadedAt: string;
}

const RECENT_KEY = "epo:recent-uploads";

function loadRecent(): RecentUpload[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function pushRecent(item: RecentUpload) {
  const all = loadRecent();
  const next = [item, ...all.filter((r) => r.jobId !== item.jobId)].slice(0, 5);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

async function detectBlobMode(): Promise<boolean> {
  try {
    const r = await fetch("/api/upload-mode", { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.blob;
  } catch {
    return false;
  }
}

export default function UploadDropzone() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [recent, setRecent] = useState<RecentUpload[]>(() => loadRecent());
  const [blobMode, setBlobMode] = useState<boolean | null>(null);

  useEffect(() => {
    detectBlobMode().then(setBlobMode);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      if (!/\.pdf$/i.test(file.name)) {
        setError("Only .pdf files are accepted.");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setError(`File too large (max 50 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB).`);
        return;
      }
      setUploading(true);
      setProgress(0);
      try {
        const useBlob = blobMode ?? (await detectBlobMode());
        let jobId: string;
        let pdfPath: string;
        if (useBlob) {
          jobId = uuid();
          const pathname = `jobs/${jobId}/source.pdf`;
          const blob = await upload(pathname, file, {
            access: "public",
            handleUploadUrl: "/api/upload",
            contentType: "application/pdf",
            clientPayload: JSON.stringify({ jobId, pdfName: file.name }),
            onUploadProgress: (e) => setProgress(e.percentage),
          });
          pdfPath = blob.url;
          fetch("/api/process", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jobId, pdfName: file.name, pdfPath }),
            keepalive: true,
          }).catch(() => {});
        } else {
          const form = new FormData();
          form.append("file", file);
          const xhr = new XMLHttpRequest();
          const done = new Promise<{ jobId: string; pdfPath: string }>((resolve, reject) => {
            xhr.upload.addEventListener("progress", (e) => {
              if (e.lengthComputable) setProgress((e.loaded / e.total) * 100);
            });
            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { reject(new Error("Bad server response")); }
              } else {
                try { reject(new Error(JSON.parse(xhr.responseText).error ?? "Upload failed")); }
                catch { reject(new Error(`Upload failed (${xhr.status})`)); }
              }
            });
            xhr.addEventListener("error", () => reject(new Error("Network error")));
            xhr.open("POST", "/api/upload");
            xhr.send(form);
          });
          const r = await done;
          jobId = r.jobId;
          pdfPath = r.pdfPath;
          fetch("/api/process", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jobId, pdfName: file.name, pdfPath }),
            keepalive: true,
          }).catch(() => {});
        }
        pushRecent({ jobId, pdfName: file.name, uploadedAt: new Date().toISOString() });
        setRecent(loadRecent());
        router.push(`/results/${jobId}`);
      } catch (e: any) {
        setError(e.message ?? "Upload failed");
        setUploading(false);
      }
    },
    [router, blobMode],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full space-y-8">
      {/* Drafting plate */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative cursor-pointer rounded-md bg-surface shadow-plate transition-colors",
          "px-10 py-14 sm:px-14 sm:py-20",
          dragging ? "bg-surface-2" : "",
          uploading && "pointer-events-none",
        )}
      >
        {/* Drafting brackets at corners */}
        <PlateBracket pos="tl" active={dragging} />
        <PlateBracket pos="tr" active={dragging} />
        <PlateBracket pos="bl" active={dragging} />
        <PlateBracket pos="br" active={dragging} />

        {/* Inner border */}
        <div
          className={cn(
            "absolute inset-3 border rounded-sm transition-colors pointer-events-none",
            dragging ? "border-primary/70" : "border-border",
          )}
        />

        {/* Subtle inner grid */}
        <div className="absolute inset-3 rounded-sm bg-draft-grid opacity-30 pointer-events-none" />

        {/* Scanline when uploading */}
        {uploading && (
          <div className="absolute inset-3 rounded-sm overflow-hidden pointer-events-none scanline" />
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />

        <div className="relative flex flex-col items-center text-center">
          {/* Crosshair / upload mark */}
          <Crosshair active={dragging || uploading} />

          <div className="mt-6 space-y-2">
            {uploading ? (
              <>
                <p className="font-display text-2xl text-foreground">
                  Uploading <span className="num text-primary">{Math.round(progress)}%</span>
                </p>
                <p className="font-mono text-[11px] uppercase tracking-wider2 text-muted-foreground">
                  Streaming directly to storage…
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-2xl text-foreground">
                  {dragging ? "Release to upload" : "Drop a PDF here"}
                </p>
                <p className="font-mono text-[11px] uppercase tracking-wider2 text-muted-foreground">
                  or click to browse · Max 50 MB · Engineering drawings
                </p>
              </>
            )}
          </div>

          {uploading && (
            <div className="mt-6 w-full max-w-sm">
              <div className="relative h-px bg-border">
                <div
                  className="absolute inset-y-0 left-0 bg-primary transition-all duration-150 ease-out"
                  style={{ width: `${progress}%` }}
                />
                {/* Dimension caps */}
                <span className="absolute -top-1 -left-px w-px h-3 bg-primary" />
                <span className="absolute -top-1 right-0 w-px h-3 bg-border-strong" />
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] tracking-wider2 text-muted-foreground uppercase num">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-sm border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <span className="mt-0.5 font-mono text-[10px] uppercase tracking-wider2 text-destructive shrink-0">
            ERR
          </span>
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground">
              Recent jobs
            </h2>
            <span className="flex-1 h-px bg-border" />
            <span className="font-mono text-[10px] tracking-wider2 text-muted-foreground num">
              {recent.length.toString().padStart(2, "0")}
            </span>
          </div>
          <ul className="divide-y divide-border/70">
            {recent.map((r) => (
              <li key={r.jobId}>
                <a
                  href={`/results/${r.jobId}`}
                  className="group flex items-center justify-between gap-3 py-3 text-sm hover:text-foreground transition-colors"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <FileText className="size-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="truncate font-medium">{r.pdfName}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span className="font-mono num hidden sm:inline">
                      {new Date(r.uploadedAt).toLocaleString()}
                    </span>
                    <ArrowUpRight className="size-3.5 text-muted-foreground/60 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PlateBracket({ pos, active }: { pos: "tl" | "tr" | "bl" | "br"; active?: boolean }) {
  const place = {
    tl: "top-1 left-1",
    tr: "top-1 right-1",
    bl: "bottom-1 left-1",
    br: "bottom-1 right-1",
  }[pos];
  const rotate = { tl: 0, tr: 90, br: 180, bl: 270 }[pos];
  return (
    <svg
      className={cn(
        "absolute size-5 transition-colors",
        active ? "text-primary" : "text-border-strong",
        place,
      )}
      viewBox="0 0 16 16"
      fill="none"
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path d="M2 7 V2 H7" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function Crosshair({ active }: { active?: boolean }) {
  return (
    <div
      className={cn(
        "relative size-20 rounded-full border transition-colors",
        active ? "border-primary" : "border-border-strong",
      )}
    >
      <div className={cn("absolute inset-0 rounded-full border transition-colors", active ? "border-primary/30" : "border-border")}
        style={{ transform: "scale(1.4)" }} />
      <span className={cn("absolute left-1/2 top-1/2 w-px h-9 -translate-x-1/2 -translate-y-1/2 transition-colors", active ? "bg-primary" : "bg-border-strong")} />
      <span className={cn("absolute left-1/2 top-1/2 h-px w-9 -translate-x-1/2 -translate-y-1/2 transition-colors", active ? "bg-primary" : "bg-border-strong")} />
      <span className={cn("absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors", active ? "bg-primary" : "bg-foreground")} />
    </div>
  );
}
