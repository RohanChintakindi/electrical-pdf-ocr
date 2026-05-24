"use client";
import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { v4 as uuid } from "uuid";
import { cn } from "@/lib/cn";
import { Upload, FileText, Loader2 } from "lucide-react";

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

// Detects whether the server is running on Vercel (Blob mode) vs. local dev.
// On Vercel, we use direct-to-Blob client upload to bypass the 4.5 MB function
// body limit. On local, we use a multipart POST.
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

  useEffect(() => { detectBlobMode().then(setBlobMode); }, []);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    if (!/\.pdf$/i.test(file.name)) { setError("Only .pdf files are accepted."); return; }
    if (file.size > 50 * 1024 * 1024) { setError(`File too large (max 50 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB).`); return; }
    setUploading(true);
    setProgress(0);
    try {
      const useBlob = blobMode ?? await detectBlobMode();
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
        // Kick off processing from the browser — a fetch inside the upload
        // serverless function gets killed when the function exits.
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
              try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Bad server response")); }
            } else {
              try { reject(new Error(JSON.parse(xhr.responseText).error ?? "Upload failed")); } catch { reject(new Error(`Upload failed (${xhr.status})`)); }
            }
          });
          xhr.addEventListener("error", () => reject(new Error("Network error")));
          xhr.open("POST", "/api/upload");
          xhr.send(form);
        });
        const r = await done;
        jobId = r.jobId;
        pdfPath = r.pdfPath;
        // Local dev: kick off processing from the browser too, for parity
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
  }, [router, blobMode]);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full max-w-2xl space-y-8">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-all",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        <div className="flex flex-col items-center gap-4">
          {uploading ? (
            <Loader2 className="size-12 animate-spin text-primary" />
          ) : (
            <div className="rounded-full bg-muted p-4">
              <Upload className="size-8 text-primary" />
            </div>
          )}
          <div className="space-y-1">
            <p className="text-lg font-medium">
              {uploading ? `Uploading… ${Math.round(progress)}%` : "Drop a PDF here, or click to browse"}
            </p>
            <p className="text-sm text-muted-foreground">Engineering drawings, max 50 MB</p>
          </div>
          {uploading && (
            <div className="w-full max-w-xs h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent uploads</h2>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.jobId}>
                <a
                  href={`/results/${r.jobId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-accent/40 px-4 py-2.5 text-sm hover:bg-accent hover:border-muted-foreground/30 transition-colors"
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{r.pdfName}</span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(r.uploadedAt).toLocaleString()}
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
