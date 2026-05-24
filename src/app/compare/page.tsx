"use client";
import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { JobResult } from "@/lib/types";

function CompareInner() {
  const params = useSearchParams();
  const a = params.get("a");
  const b = params.get("b");
  const [jobA, setJobA] = useState<JobResult | null>(null);
  const [jobB, setJobB] = useState<JobResult | null>(null);

  useEffect(() => {
    if (a) fetch(`/api/result/${a}`).then((r) => r.json()).then(setJobA).catch(() => {});
    if (b) fetch(`/api/result/${b}`).then((r) => r.json()).then(setJobB).catch(() => {});
  }, [a, b]);

  if (!a || !b) {
    return <div className="p-12 text-center text-muted-foreground">Compare requires <code className="font-mono">?a=jobId&amp;b=jobId</code> in the URL.</div>;
  }

  const codesA = new Map((jobA?.codes ?? []).map((c) => [c.code, c.count]));
  const codesB = new Map((jobB?.codes ?? []).map((c) => [c.code, c.count]));
  const allCodes = Array.from(new Set([...codesA.keys(), ...codesB.keys()])).sort();

  return (
    <main className="min-h-screen p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Compare</h1>
        <a href="/" className="text-sm text-muted-foreground hover:text-foreground">← New upload</a>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card job={jobA} label="A" />
        <Card job={jobB} label="B" />
      </div>
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Code</th>
              <th className="text-right px-4 py-2 font-medium">A</th>
              <th className="text-right px-4 py-2 font-medium">B</th>
              <th className="text-right px-4 py-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {allCodes.map((c) => {
              const av = codesA.get(c) ?? 0;
              const bv = codesB.get(c) ?? 0;
              const delta = bv - av;
              return (
                <tr key={c} className="border-t border-border/50">
                  <td className="px-4 py-1.5 font-mono">{c}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{av}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{bv}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-green-500" : "text-destructive"}`}>
                    {delta > 0 ? `+${delta}` : delta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Card({ job, label }: { job: JobResult | null; label: string }) {
  if (!job) return <div className="rounded-lg border border-border bg-muted/30 p-6 text-sm text-muted-foreground">Loading {label}…</div>;
  return (
    <div className="rounded-lg border border-border bg-accent/30 p-4 space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <a href={`/results/${job.jobId}`} className="text-xs text-primary hover:underline">Open viewer →</a>
      </div>
      <h3 className="text-base font-medium truncate">{job.pdfName}</h3>
      <div className="text-xs text-muted-foreground">
        {job.meta.totalPages} pages · {job.meta.totalHits} hits · {job.codes.length} unique codes
      </div>
    </div>
  );
}

export default function ComparePage() {
  return <Suspense fallback={<div className="p-12">Loading…</div>}><CompareInner /></Suspense>;
}
