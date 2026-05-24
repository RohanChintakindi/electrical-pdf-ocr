"use client";

import { useState } from "react";

type Status = "idle" | "confirm" | "running" | "ok" | "error";

interface Result {
  deleted: number;
  freedMB: number;
  error?: string;
}

export default function ClearBlobsPanel() {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setStatus("running");
    setResult(null);
    try {
      const resp = await fetch("/api/admin/clear-blobs", { method: "POST" });
      const json = (await resp.json()) as { ok: boolean; deleted?: number; freedMB?: number; error?: string };
      if (json.ok) {
        setResult({ deleted: json.deleted ?? 0, freedMB: json.freedMB ?? 0 });
        setStatus("ok");
      } else {
        setResult({ deleted: json.deleted ?? 0, freedMB: json.freedMB ?? 0, error: json.error });
        setStatus("error");
      }
    } catch (e: any) {
      setResult({ deleted: 0, freedMB: 0, error: e?.message ?? String(e) });
      setStatus("error");
    }
  }

  return (
    <div className="mt-10 border border-border/70 bg-surface/60 backdrop-blur-sm">
      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground">
          Maintenance
        </p>
        <span className="font-mono text-[9px] uppercase tracking-wider2 text-border-strong">
          /admin
        </span>
      </div>
      <div className="px-4 py-4 space-y-3">
        <p className="text-sm text-foreground/85 leading-relaxed">
          Wipe blob storage
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Every upload stores the source PDF plus a rendered PNG per page
          (~10-20 MB each). Vercel Hobby caps blob storage at <span className="font-mono text-foreground/80">1 GB</span>,
          so ~50-100 jobs and uploads start failing with <span className="font-mono text-foreground/80">quota exceeded</span>.
          This wipes every blob in one shot so you can keep testing without
          dropping to a CLI. Existing job links break after clearing.
        </p>

        {status === "idle" && (
          <button
            type="button"
            onClick={() => setStatus("confirm")}
            className="w-full mt-1 px-3 py-2 border border-border-strong text-foreground/85 font-mono text-[11px] uppercase tracking-wider2 hover:bg-surface-2 transition-colors"
          >
            Clear all blobs
          </button>
        )}

        {status === "confirm" && (
          <div className="space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider2 text-primary">
              Confirm — this deletes every stored job
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={run}
                className="flex-1 px-3 py-2 bg-primary text-primary-foreground font-mono text-[11px] uppercase tracking-wider2 hover:bg-primary/90 transition-colors"
              >
                Yes, wipe
              </button>
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="px-3 py-2 border border-border text-muted-foreground font-mono text-[11px] uppercase tracking-wider2 hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === "running" && (
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider2 text-muted-foreground">
            <span className="inline-block size-1.5 rounded-full bg-primary animate-pulse-soft" />
            Wiping…
          </div>
        )}

        {status === "ok" && result && (
          <div className="space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider2 text-success">
              Done · {result.deleted} blobs · {result.freedMB} MB freed
            </p>
            <p className="text-[10px] text-muted-foreground">
              Quota recalculates in ~60-90s on Vercel's side.
            </p>
            <button
              type="button"
              onClick={() => { setStatus("idle"); setResult(null); }}
              className="text-[10px] font-mono uppercase tracking-wider2 text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        )}

        {status === "error" && result && (
          <div className="space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-wider2 text-destructive">
              Failed{result.deleted ? ` after ${result.deleted} blobs` : ""}
            </p>
            <p className="text-[10px] text-muted-foreground break-words">{result.error}</p>
            <button
              type="button"
              onClick={() => { setStatus("idle"); setResult(null); }}
              className="text-[10px] font-mono uppercase tracking-wider2 text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
