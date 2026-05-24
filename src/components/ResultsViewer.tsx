"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { JobResult, PageResult, Instance } from "@/lib/types";
import { cn } from "@/lib/cn";
import { Download, FileJson, Link as LinkIcon, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";

interface Props {
  initial: JobResult;
}

const POLL_MS = 2000;
const LOW_CONF = 0.7;

export default function ResultsViewer({ initial }: Props) {
  const [job, setJob] = useState<JobResult>(initial);
  const [pageIdx, setPageIdx] = useState(0);
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [spotcheck, setSpotcheck] = useState(false);
  const [copied, setCopied] = useState(false);
  const zoomRef = useRef<ReactZoomPanPinchRef>(null);

  // Poll until complete
  useEffect(() => {
    if (job.status === "complete" || job.status === "error") return;
    const tid = setInterval(async () => {
      try {
        const r = await fetch(`/api/result/${job.jobId}`, { cache: "no-store" });
        if (r.ok) {
          const next: JobResult = await r.json();
          setJob(next);
        }
      } catch {}
    }, POLL_MS);
    return () => clearInterval(tid);
  }, [job.jobId, job.status]);

  const page: PageResult | undefined = job.pages[pageIdx];

  const filteredCodes = useMemo(() => {
    if (!filter.trim()) return job.codes;
    const f = filter.trim().toUpperCase().replace(/\*/g, ".*");
    let re: RegExp;
    try { re = new RegExp(`^${f}`, "i"); } catch { return job.codes; }
    return job.codes.filter((c) => re.test(c.code));
  }, [job.codes, filter]);

  const toggleHidden = (code: string) => {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(code)) n.delete(code); else n.add(code);
      return n;
    });
  };

  const jumpToCode = useCallback((code: string) => {
    setActiveCode(code);
    for (let i = 0; i < job.pages.length; i++) {
      const found = job.pages[i].instances.find((inst) => inst.code === code);
      if (found) {
        setPageIdx(i);
        return;
      }
    }
  }, [job.pages]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") setPageIdx((i) => Math.max(0, i - 1));
      else if (e.key === "ArrowRight") setPageIdx((i) => Math.min(job.pages.length - 1, i + 1));
      else if (e.key === "f" || e.key === "F") zoomRef.current?.resetTransform();
      else if (e.key === "Escape") setActiveCode(null);
      else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < filteredCodes.length) toggleHidden(filteredCodes[idx].code);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [job.pages.length, filteredCodes]);

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const lowConfCodes = useMemo(() => {
    const s = new Set<string>();
    for (const p of job.pages) {
      for (const i of p.instances) {
        if (i.conf < LOW_CONF) s.add(i.code);
      }
    }
    return s;
  }, [job.pages]);

  const overallStatus = job.status;

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5 gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground shrink-0">← New upload</a>
          <div className="h-4 w-px bg-border" />
          <span className="truncate text-sm font-medium">{job.pdfName}</span>
          <StatusPill status={overallStatus} />
          <span className="text-xs text-muted-foreground shrink-0 hidden md:block">
            {new Date(job.processedAt).toLocaleString()} · {job.ocrEngine}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setSpotcheck((s) => !s)}
            className={cn("px-2.5 py-1.5 rounded-md text-xs border transition-colors", spotcheck ? "bg-primary text-primary-foreground border-primary" : "bg-accent hover:bg-accent/70 border-border")}>
            Spot-check
          </button>
          <a href={`/api/export-pdf/${job.jobId}`} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border bg-accent hover:bg-accent/70 transition-colors">
            <Download className="size-3.5" /> Annotated PDF
          </a>
          <a href={`/api/export-json/${job.jobId}`} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border bg-accent hover:bg-accent/70 transition-colors">
            <FileJson className="size-3.5" /> JSON
          </a>
          <button onClick={copyShare} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border bg-accent hover:bg-accent/70 transition-colors">
            <LinkIcon className="size-3.5" /> {copied ? "Copied" : "Share"}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        {/* Viewer */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#0a0d11]">
          <div className="flex-1 min-h-0 relative">
            {page ? (
              <PageViewer
                page={page}
                activeCode={activeCode}
                hidden={hidden}
                onClickBox={(inst) => setActiveCode(inst.code === activeCode ? null : inst.code)}
                zoomRef={zoomRef}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
                {overallStatus === "queued" ? "Queued. Waiting for processing to start…" : "No pages yet"}
              </div>
            )}
            <div className="absolute top-3 right-3 flex flex-col gap-1.5 bg-background/80 backdrop-blur border border-border rounded-md p-1 z-10">
              <button onClick={() => zoomRef.current?.zoomIn()} className="p-1.5 hover:bg-accent rounded" title="Zoom in"><ZoomIn className="size-4" /></button>
              <button onClick={() => zoomRef.current?.zoomOut()} className="p-1.5 hover:bg-accent rounded" title="Zoom out"><ZoomOut className="size-4" /></button>
              <button onClick={() => zoomRef.current?.resetTransform()} className="p-1.5 hover:bg-accent rounded" title="Fit (F)"><Maximize2 className="size-4" /></button>
            </div>
          </div>

          {/* Page nav */}
          <div className="border-t border-border bg-background/60 px-3 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
              {job.pages.map((p, i) => (
                <PageBadge key={p.pageNumber} page={p} active={i === pageIdx} onClick={() => setPageIdx(i)} />
              ))}
              {job.pages.length === 0 && <span className="text-xs text-muted-foreground px-2">No pages rendered yet</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0}
                className="p-1 rounded hover:bg-accent disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <span className="text-xs tabular-nums text-muted-foreground min-w-[3rem] text-center">
                {page ? `${pageIdx + 1} / ${job.pages.length}` : "—"}
              </span>
              <button onClick={() => setPageIdx((i) => Math.min(job.pages.length - 1, i + 1))} disabled={pageIdx >= job.pages.length - 1}
                className="p-1 rounded hover:bg-accent disabled:opacity-30"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-[340px] shrink-0 border-l border-border flex flex-col bg-background min-h-0">
          <div className="p-3 border-b border-border space-y-2 shrink-0">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Codes</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {job.meta.totalHits} hits · {job.codes.length} unique
              </span>
            </div>
            <input
              type="text"
              placeholder="Filter (e.g. LF7*)"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-md bg-muted border border-border px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {filteredCodes.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {job.codes.length === 0 ? "Waiting for results…" : "No matches"}
              </div>
            ) : (
              <ul>
                {filteredCodes.map((c) => (
                  <CodeRow
                    key={c.code}
                    code={c.code}
                    description={c.description}
                    count={c.count}
                    color={c.color}
                    active={activeCode === c.code}
                    hidden={hidden.has(c.code)}
                    lowConf={lowConfCodes.has(c.code)}
                    onJump={() => jumpToCode(c.code)}
                    onToggle={() => toggleHidden(c.code)}
                  />
                ))}
              </ul>
            )}
          </div>

          {spotcheck && <SpotCheckPanel job={job} />}
        </aside>
      </div>
    </div>
  );
}

function PageViewer({
  page,
  activeCode,
  hidden,
  onClickBox,
  zoomRef,
}: {
  page: PageResult;
  activeCode: string | null;
  hidden: Set<string>;
  onClickBox: (inst: Instance) => void;
  zoomRef: React.MutableRefObject<ReactZoomPanPinchRef | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Compute initial fit-to-width scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !page) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const s = Math.min(cw / page.width, ch / page.height) * 0.95;
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  if (page.status === "pending") {
    return <div ref={containerRef} className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">Queued for OCR…</div>;
  }
  if (page.status === "processing") {
    return (
      <div ref={containerRef} className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
        <div className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Processing page {page.pageNumber}…</div>
      </div>
    );
  }
  if (page.status === "error") {
    return (
      <div ref={containerRef} className="absolute inset-0 grid place-items-center text-destructive text-sm gap-2">
        <AlertTriangle className="size-4" /> Failed: {page.errors?.join("; ") ?? "unknown error"}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      <TransformWrapper
        ref={zoomRef}
        initialScale={scale}
        minScale={0.05}
        maxScale={20}
        centerOnInit
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
        limitToBounds={false}
      >
        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ width: page.width, height: page.height }}>
          <div className="relative" style={{ width: page.width, height: page.height }}>
            <img src={page.imageUrl} width={page.width} height={page.height} alt={`Page ${page.pageNumber}`} className="block select-none pointer-events-none" draggable={false} />
            {page.instances.map((inst, i) => {
              const isHidden = hidden.has(inst.code);
              if (isHidden) return null;
              const isActive = activeCode === inst.code;
              const faded = activeCode && !isActive;
              const color = colorForCode(inst.code);
              return (
                <div
                  key={i}
                  onClick={(e) => { e.stopPropagation(); onClickBox(inst); }}
                  className={cn("absolute group cursor-pointer transition-opacity", faded ? "opacity-15" : "opacity-100")}
                  style={{
                    left: inst.x - 2,
                    top: inst.y - 2,
                    width: inst.w + 4,
                    height: inst.h + 4,
                    border: `2px solid ${color}`,
                    background: isActive ? `${color}25` : "transparent",
                    boxShadow: isActive ? `0 0 0 2px ${color}66` : undefined,
                  }}
                  title={`${inst.code} (conf ${inst.conf.toFixed(2)})`}
                >
                  <span
                    className="absolute -top-5 left-0 px-1 py-0.5 rounded text-[10px] font-mono font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: color, color: "#fff" }}
                  >
                    {inst.code}
                  </span>
                </div>
              );
            })}
          </div>
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

function CodeRow({
  code, description, count, color, active, hidden, lowConf, onJump, onToggle,
}: {
  code: string; description: string; count: number; color: string;
  active: boolean; hidden: boolean; lowConf: boolean;
  onJump: () => void; onToggle: () => void;
}) {
  return (
    <li className={cn("flex items-center gap-2 px-3 py-2 border-b border-border/50 hover:bg-accent/30 transition-colors", active && "bg-accent/50")}>
      <button onClick={onToggle} className="size-4 shrink-0 rounded-sm border" style={{ background: hidden ? "transparent" : color, borderColor: color }} title={hidden ? "Show" : "Hide"} />
      <button onClick={onJump} className="flex-1 min-w-0 text-left">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-sm font-medium">{code}</span>
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        </div>
        {description && <div className="text-xs text-muted-foreground truncate">{description}</div>}
      </button>
      {lowConf && <AlertTriangle className="size-3.5 text-yellow-500 shrink-0" />}
    </li>
  );
}

function PageBadge({ page, active, onClick }: { page: PageResult; active: boolean; onClick: () => void }) {
  const icon = page.status === "done" ? <CheckCircle2 className="size-3 text-green-500" />
    : page.status === "processing" ? <Loader2 className="size-3 animate-spin text-primary" />
    : page.status === "error" ? <AlertTriangle className="size-3 text-destructive" />
    : <span className="size-3 inline-block rounded-full border border-muted-foreground/40" />;
  return (
    <button onClick={onClick}
      className={cn("flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors shrink-0",
        active ? "bg-primary text-primary-foreground" : "bg-accent hover:bg-accent/70")}>
      {icon}
      <span>p{page.pageNumber}</span>
      {page.status === "done" && <span className="tabular-nums opacity-70">·{page.instances.length}</span>}
    </button>
  );
}

function StatusPill({ status }: { status: JobResult["status"] }) {
  const styles = {
    queued: "bg-muted text-muted-foreground",
    processing: "bg-primary/15 text-primary",
    complete: "bg-green-500/15 text-green-500",
    partial: "bg-yellow-500/15 text-yellow-500",
    error: "bg-destructive/15 text-destructive",
  }[status];
  return <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide shrink-0", styles)}>{status}</span>;
}

function SpotCheckPanel({ job }: { job: JobResult }) {
  const [expected, setExpected] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`epo:expected:${job.jobId}`);
      if (raw) setExpected(JSON.parse(raw));
    } catch {}
  }, [job.jobId]);
  const update = (code: string, val: string) => {
    const n = parseInt(val, 10);
    const next = { ...expected };
    if (Number.isFinite(n) && n >= 0) next[code] = n; else delete next[code];
    setExpected(next);
    localStorage.setItem(`epo:expected:${job.jobId}`, JSON.stringify(next));
  };
  return (
    <div className="border-t border-border bg-accent/30 p-3 shrink-0 max-h-[40%] overflow-y-auto scrollbar-thin">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Spot-check</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-normal pb-1">Code</th>
            <th className="text-right font-normal pb-1">Found</th>
            <th className="text-right font-normal pb-1">Expected</th>
          </tr>
        </thead>
        <tbody>
          {job.codes.map((c) => {
            const exp = expected[c.code];
            const mismatch = exp != null && exp !== c.count;
            return (
              <tr key={c.code} className={cn(mismatch && "text-destructive")}>
                <td className="font-mono py-0.5">{c.code}</td>
                <td className="text-right tabular-nums py-0.5">{c.count}</td>
                <td className="text-right py-0.5">
                  <input type="number" min={0} value={exp ?? ""} onChange={(e) => update(c.code, e.target.value)}
                    className="w-12 bg-muted rounded px-1 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-primary" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function colorForCode(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 85% 45%)`;
}
