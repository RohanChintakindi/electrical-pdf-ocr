"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { TransformWrapper, TransformComponent, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import type { JobResult, PageResult, Instance } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  Download, FileJson, Link as LinkIcon, ZoomIn, ZoomOut, Maximize2,
  ChevronLeft, ChevronRight, AlertTriangle,
} from "lucide-react";

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

  const pagesDone = useMemo(() => job.pages.filter((p) => p.status === "done").length, [job.pages]);
  const pagesStarted = useMemo(() => job.pages.filter((p) => p.status === "processing").length, [job.pages]);
  const pagesTotal = job.pages.length || job.meta.totalPages || 0;
  const isProcessing = overallStatus === "queued" || overallStatus === "processing";

  // Time-based smoothing — the bar self-advances toward a ceiling based on
  // expected wall time, capped by the actual server-reported progress. Even
  // when all 7 workers are silently churning, the bar keeps moving.
  // Anchor elapsed to the server's processedAt timestamp (set when the
  // orchestrator seeded the job) so navigating away and back doesn't reset
  // the timer — the job runs on serverless workers, not in the browser.
  const startMs = useMemo(
    () => (job.processedAt ? new Date(job.processedAt).getTime() : Date.now()),
    [job.processedAt],
  );
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (!isProcessing) return;
    const tid = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tid);
  }, [isProcessing]);

  // Server-derived: started pages = half credit, done = full credit. Scales
  // to 0-80 (last 20 reserved for finalize).
  const serverPct = pagesTotal > 0
    ? ((pagesDone + pagesStarted * 0.5) / pagesTotal) * 80
    : 0;
  // Time-derived: log curve that hits ~70 at expected wall (60s) and
  // asymptotes to 88. Gives the bar life when nothing else is moving.
  const elapsedSec = Math.max(0, (now - startMs) / 1000);
  const timePct = isProcessing
    ? Math.min(88, 88 * (1 - Math.exp(-elapsedSec / 30)))
    : 0;
  // Take whichever is higher — when server is silent, time pulls it. When
  // server is reporting real progress, server can outpace the time curve.
  const finalizingBoost = pagesTotal > 0 && pagesDone === pagesTotal ? 15 : 0;
  const overallPct = isProcessing
    ? Math.min(96, Math.round(Math.max(serverPct, timePct) + finalizingBoost))
    : 100;

  const jobShort = job.jobId.slice(0, 8);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Instrument top bar */}
      <header className="relative flex items-center justify-between border-b border-border bg-surface gap-4 shrink-0 pl-3 pr-4 py-2">
        {/* Status accent stripe */}
        <span className={cn(
          "absolute left-0 top-0 bottom-0 w-[3px]",
          overallStatus === "complete" && "bg-success",
          overallStatus === "processing" && "bg-primary animate-pulse-soft",
          overallStatus === "queued" && "bg-border-strong",
          overallStatus === "partial" && "bg-primary",
          overallStatus === "error" && "bg-destructive",
        )} />

        <div className="flex items-center gap-3 min-w-0">
          <a href="/" className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground hover:text-foreground transition-colors shrink-0">
            ← Index
          </a>
          <span className="text-border-strong shrink-0">/</span>
          <span className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground shrink-0 num">
            {jobShort}
          </span>
          <span className="text-border-strong shrink-0">/</span>
          <span className="truncate text-sm font-medium text-foreground" title={job.pdfName}>{job.pdfName}</span>
          <StatusChip status={overallStatus} />
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <GhostButton onClick={() => setSpotcheck((s) => !s)} active={spotcheck}>
            Spot-check
          </GhostButton>
          <GhostLink href={`/api/export-pdf/${job.jobId}`}>
            <Download className="size-3.5" /> PDF
          </GhostLink>
          <GhostLink href={`/api/export-json/${job.jobId}`}>
            <FileJson className="size-3.5" /> JSON
          </GhostLink>
          <GhostButton onClick={copyShare}>
            <LinkIcon className="size-3.5" /> {copied ? "Copied" : "Share"}
          </GhostButton>
        </div>
      </header>

      {/* Progress panel — visible while processing */}
      {isProcessing && (
        <ProgressPanel
          status={overallStatus}
          pagesDone={pagesDone}
          pagesStarted={pagesStarted}
          pagesTotal={pagesTotal}
          legendStatus={job.legendStatus}
          overallPct={overallPct}
          elapsedSec={elapsedSec}
        />
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Viewer */}
        <div className="flex-1 min-w-0 flex flex-col relative bg-[#08080a]">
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
              <EmptyViewer label={overallStatus === "queued" ? "Awaiting input" : "No pages yet"} />
            )}

            {/* Zoom controls */}
            <div className="absolute top-3 right-3 flex flex-col bg-surface/90 backdrop-blur border border-border rounded-sm z-10 shadow-plate">
              <IconBtn onClick={() => zoomRef.current?.zoomIn()} title="Zoom in (+)"><ZoomIn className="size-3.5" /></IconBtn>
              <span className="h-px bg-border" />
              <IconBtn onClick={() => zoomRef.current?.zoomOut()} title="Zoom out (−)"><ZoomOut className="size-3.5" /></IconBtn>
              <span className="h-px bg-border" />
              <IconBtn onClick={() => zoomRef.current?.resetTransform()} title="Fit (F)"><Maximize2 className="size-3.5" /></IconBtn>
            </div>

            {/* Drawing meta — bottom-left overlay. Instances only show once
                finalize has merged the legend filter; before that the page's
                raw hits are sitting in its own blob but haven't been counted. */}
            {page && page.status === "done" && (
              <div className="absolute left-3 bottom-3 z-10 bg-surface/90 backdrop-blur border border-border rounded-sm px-3 py-2 font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground">
                {!isProcessing ? (
                  <>
                    <span className="text-foreground num">{page.instances.length.toString().padStart(3, "0")}</span> instances
                    <span className="mx-2 text-border-strong">·</span>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground/60">awaiting merge</span>
                    <span className="mx-2 text-border-strong">·</span>
                  </>
                )}
                <span className="num">{page.width}×{page.height}</span>
              </div>
            )}
          </div>

          {/* Page nav strip — segmented instrument */}
          <div className="border-t border-border bg-surface px-3 py-2 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin">
              {job.pages.map((p, i) => (
                <PageBadge key={p.pageNumber} page={p} active={i === pageIdx} onClick={() => setPageIdx(i)} />
              ))}
              {job.pages.length === 0 && (
                <span className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground px-2">
                  No pages rendered yet
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <IconBtn onClick={() => setPageIdx((i) => Math.max(0, i - 1))} disabled={pageIdx === 0} title="Previous (←)">
                <ChevronLeft className="size-4" />
              </IconBtn>
              <span className="font-mono text-[10px] tracking-wider2 text-muted-foreground min-w-[3.5rem] text-center num uppercase">
                {page ? `${(pageIdx + 1).toString().padStart(2, "0")} / ${job.pages.length.toString().padStart(2, "0")}` : "—"}
              </span>
              <IconBtn onClick={() => setPageIdx((i) => Math.min(job.pages.length - 1, i + 1))} disabled={pageIdx >= job.pages.length - 1} title="Next (→)">
                <ChevronRight className="size-4" />
              </IconBtn>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-[360px] shrink-0 border-l border-border flex flex-col bg-background min-h-0">
          <div className="px-4 pt-4 pb-3 border-b border-border space-y-3 shrink-0">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg text-foreground">Schedule</h2>
              <span className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground num">
                {isProcessing && job.codes.length === 0 ? (
                  <span className="text-muted-foreground/60">— pending —</span>
                ) : (
                  <>
                    <span className="text-foreground">{job.meta.totalHits.toString().padStart(3, "0")}</span> hits
                    <span className="mx-1 text-border-strong">·</span>
                    <span className="text-foreground">{job.codes.length.toString().padStart(2, "0")}</span> unique
                  </>
                )}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted-foreground select-none">/</span>
              <input
                type="text"
                placeholder="filter (e.g. LF7*)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full rounded-sm bg-surface border border-border pl-7 pr-3 py-1.5 text-sm font-mono placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {filteredCodes.length === 0 ? (
              <div className="p-10 text-center font-mono text-[11px] uppercase tracking-wider2 text-muted-foreground">
                {job.codes.length === 0 ? "Awaiting data…" : "No matches"}
              </div>
            ) : (
              <ul>
                {filteredCodes.map((c, idx) => (
                  <CodeRow
                    key={c.code}
                    index={idx}
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

          {/* Keyboard hints */}
          <div className="border-t border-border px-4 py-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground/80">
            <span><kbd className="text-foreground">F</kbd> fit · <kbd className="text-foreground">←/→</kbd> pages</span>
            <span><kbd className="text-foreground">esc</kbd> deselect</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PageViewer({
  page, activeCode, hidden, onClickBox, zoomRef,
}: {
  page: PageResult;
  activeCode: string | null;
  hidden: Set<string>;
  onClickBox: (inst: Instance) => void;
  zoomRef: React.MutableRefObject<ReactZoomPanPinchRef | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !page || page.width === 0 || page.height === 0) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw === 0 || ch === 0) return;
      const s = Math.min(cw / page.width, ch / page.height) * 0.95;
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  if (page.status === "pending") {
    return <EmptyViewer label="Queued for OCR" />;
  }
  if (page.status === "processing") {
    return <EmptyViewer label={`Processing page ${page.pageNumber}`} pulsing />;
  }
  if (page.status === "error") {
    return (
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-3 text-destructive">
          <AlertTriangle className="size-6" />
          <span className="font-mono text-[11px] uppercase tracking-wider2">
            page {page.pageNumber} failed
          </span>
          <span className="text-xs max-w-md text-center text-destructive/80">
            {page.errors?.join("; ") ?? "unknown error"}
          </span>
        </div>
      </div>
    );
  }

  // Don't mount the zoom wrapper until we have a real fit-to-page scale.
  // Otherwise initialScale=1 sticks and the page renders 25x zoomed in.
  if (scale === null) {
    return <div ref={containerRef} className="absolute inset-0" />;
  }

  return (
    <div ref={containerRef} className="absolute inset-0">
      <TransformWrapper
        key={`${page.pageNumber}-${page.width}-${page.height}`}
        ref={zoomRef}
        initialScale={scale}
        minScale={Math.min(0.05, scale * 0.5)}
        maxScale={20}
        centerOnInit
        wheel={{ step: 0.1 }}
        doubleClick={{ disabled: true }}
        limitToBounds={false}
      >
        <TransformComponent
          wrapperStyle={{ width: "100%", height: "100%" }}
          contentStyle={{ width: page.width, height: page.height }}
        >
          <div className="relative" style={{ width: page.width, height: page.height }}>
            <img
              src={page.imageUrl}
              width={page.width}
              height={page.height}
              alt={`Page ${page.pageNumber}`}
              className="block select-none pointer-events-none"
              draggable={false}
            />
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
                    boxShadow: isActive ? `0 0 0 2px ${color}55` : undefined,
                  }}
                  title={`${inst.code} (conf ${inst.conf.toFixed(2)})`}
                >
                  <span
                    className="absolute -top-5 left-0 px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-medium whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: color, color: "#0a0908" }}
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

function ProgressPanel({
  status, pagesDone, pagesStarted, pagesTotal, legendStatus, overallPct, elapsedSec,
}: {
  status: JobResult["status"];
  pagesDone: number;
  pagesStarted: number;
  pagesTotal: number;
  legendStatus?: JobResult["legendStatus"];
  overallPct: number;
  elapsedSec: number;
}) {
  // Phase model:
  //  upload (already done by the time this view exists)
  //  pages  — running while pagesDone < pagesTotal
  //  legend — running until legendStatus is "done" or "error"
  //  finalize — running once both pages + legend are settled
  const pagesPhase: "active" | "done" =
    pagesTotal > 0 && pagesDone === pagesTotal ? "done" : "active";
  const legendPhase: "pending" | "active" | "done" | "error" =
    legendStatus === "done"
      ? "done"
      : legendStatus === "error"
      ? "error"
      : pagesStarted + pagesDone === 0
      ? "pending"
      : "active";
  const finalizePhase: "pending" | "active" | "done" =
    pagesPhase === "done" && (legendPhase === "done" || legendPhase === "error")
      ? "active"
      : "pending";

  // Pure elapsed-based countdown — overallPct sits flat while pages are
  // mid-flight, so coupling "X left" to it makes the countdown stick. This
  // ticks every second based on real elapsed time. Once we pass TARGET_SEC
  // we just hide the estimate rather than lie with a fake number.
  const TARGET_SEC = 95; // typical wall: 75-95s on Hobby with verify pass
  const remainingSec = Math.max(0, Math.round(TARGET_SEC - elapsedSec));
  const minsElapsed = Math.floor(elapsedSec / 60);
  const secsElapsed = Math.floor(elapsedSec % 60);

  // Friendly activity text — picks the most current "thing happening now"
  let activity = "Spinning up workers…";
  if (status === "queued") {
    activity = "Allocating compute…";
  } else if (pagesStarted === 0 && pagesDone === 0) {
    activity = "Warming up — first cold start is the slowest";
  } else if (pagesDone < pagesTotal) {
    activity = `Reading page${pagesStarted > 1 ? "s" : ""} ${pagesStarted} in parallel · ${pagesDone} of ${pagesTotal} complete`;
  } else if (legendPhase === "active") {
    activity = "Reading the schedule with Claude vision…";
  } else if (finalizePhase === "active") {
    activity = "Cross-referencing detections against the schedule…";
  }

  return (
    <div className="relative border-b border-border bg-surface shrink-0 overflow-hidden">
      {/* Phase stepper */}
      <div className="flex items-stretch border-b border-border/70">
        <Phase label="Upload" sub="received" state="done" />
        <PhaseConnector active />
        <Phase
          label="OCR pages"
          sub={pagesTotal > 0 ? `${pagesDone}/${pagesTotal}` : "—"}
          state={pagesPhase === "done" ? "done" : "active"}
        />
        <PhaseConnector active={legendPhase !== "pending"} />
        <Phase
          label="Schedule"
          sub={
            legendPhase === "done"
              ? "extracted"
              : legendPhase === "error"
              ? "regex only"
              : legendPhase === "active"
              ? "reading"
              : "waiting"
          }
          state={legendPhase === "done" ? "done" : legendPhase === "error" ? "error" : legendPhase === "active" ? "active" : "pending"}
        />
        <PhaseConnector active={finalizePhase !== "pending"} />
        <Phase
          label="Finalize"
          sub={finalizePhase === "active" ? "merging" : "waiting"}
          state={finalizePhase === "active" ? "active" : "pending"}
          last
        />
      </div>

      {/* Progress bar + activity + timer */}
      <div className="px-4 py-3 space-y-2 relative">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground truncate">{activity}</p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground num shrink-0">
            {minsElapsed}:{secsElapsed.toString().padStart(2, "0")} elapsed
            {remainingSec > 0 && elapsedSec >= 3 && (
              <>
                <span className="mx-1.5 text-border-strong">·</span>
                ~{remainingSec}s left
              </>
            )}
          </span>
          <span className="font-mono num text-[11px] text-primary shrink-0 w-9 text-right">{overallPct}%</span>
        </div>

        <div className="relative h-1 bg-border rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary transition-all duration-700 ease-out"
            style={{ width: `${overallPct}%` }}
          />
          <div className="absolute inset-y-0 left-0 bg-primary/40 transition-all duration-300 blur-sm"
            style={{ width: `${overallPct}%` }} />
        </div>
      </div>
      <span className="absolute inset-x-0 bottom-0 h-px pointer-events-none scanline" />
    </div>
  );
}

function Phase({
  label, sub, state, last,
}: {
  label: string;
  sub: string;
  state: "done" | "active" | "pending" | "error";
  last?: boolean;
}) {
  const dot =
    state === "done"
      ? "bg-success border-success"
      : state === "active"
      ? "bg-primary border-primary animate-pulse-soft"
      : state === "error"
      ? "bg-destructive border-destructive"
      : "bg-transparent border-border-strong";
  return (
    <div className={cn("flex-1 px-4 py-2.5 flex items-center gap-2.5 min-w-0", !last && "border-r border-border/70")}>
      <span className={cn("size-2.5 rounded-full border-2 shrink-0 transition-colors", dot)} />
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-wider2 text-foreground truncate">
          {label}
        </div>
        <div className={cn(
          "text-[10px] truncate font-mono",
          state === "done" ? "text-success"
            : state === "active" ? "text-primary"
            : state === "error" ? "text-destructive"
            : "text-muted-foreground",
        )}>
          {sub}
        </div>
      </div>
    </div>
  );
}

function PhaseConnector({ active }: { active: boolean }) {
  return (
    <div className="w-6 flex items-center justify-center">
      <span className={cn("h-px w-full transition-colors", active ? "bg-primary" : "bg-border")} />
    </div>
  );
}

function EmptyViewer({ label, pulsing }: { label: string; pulsing?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-5">
        <div className={cn("relative size-16", pulsing && "animate-pulse-soft")}>
          {/* Crosshair */}
          <span className="absolute left-1/2 top-1/2 w-px h-16 -translate-x-1/2 -translate-y-1/2 bg-border-strong" />
          <span className="absolute left-1/2 top-1/2 h-px w-16 -translate-x-1/2 -translate-y-1/2 bg-border-strong" />
          <span className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
          <span className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong" />
        </div>
        <span className="font-mono text-[11px] uppercase tracking-wider2 text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

function CodeRow({
  index, code, description, count, color, active, hidden, lowConf, onJump, onToggle,
}: {
  index: number;
  code: string; description: string; count: number; color: string;
  active: boolean; hidden: boolean; lowConf: boolean;
  onJump: () => void; onToggle: () => void;
}) {
  return (
    <li className={cn(
      "relative group border-b border-border/40 transition-colors",
      active ? "bg-surface" : "hover:bg-surface/60",
    )}>
      {/* Accent stripe */}
      <span
        className={cn("absolute left-0 top-0 bottom-0 transition-all", active ? "w-1" : "w-0.5")}
        style={{ background: hidden ? "transparent" : color }}
      />
      <div className="flex items-stretch gap-3 pl-4 pr-3 py-2.5">
        <button
          onClick={onToggle}
          className={cn(
            "size-3.5 mt-1 shrink-0 rounded-[2px] border transition-all",
            hidden ? "bg-transparent border-border-strong" : "border-transparent",
          )}
          style={hidden ? {} : { background: color }}
          title={hidden ? "Show" : "Hide"}
          aria-label={hidden ? "Show code" : "Hide code"}
        />
        <button onClick={onJump} className="flex-1 min-w-0 text-left">
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="font-mono text-[10px] text-muted-foreground/60 tabular-nums w-5 shrink-0">
                {(index + 1).toString().padStart(2, "0")}
              </span>
              <span className="font-mono text-sm font-medium text-foreground">{code}</span>
              {lowConf && (
                <AlertTriangle className="size-3 text-primary shrink-0" aria-label="Low confidence" />
              )}
            </div>
            <span className="font-mono text-xs text-muted-foreground num">
              <span className="text-foreground">{count.toString().padStart(2, "0")}</span>
            </span>
          </div>
          {description && (
            <div className="mt-0.5 pl-7 text-[11px] text-muted-foreground line-clamp-2 leading-snug">
              {description}
            </div>
          )}
        </button>
      </div>
    </li>
  );
}

function PageBadge({ page, active, onClick }: { page: PageResult; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-2.5 py-1 rounded-sm font-mono text-[11px] transition-all shrink-0 border",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border bg-surface hover:bg-surface-2 hover:border-border-strong text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full transition-colors",
          page.status === "done" && (active ? "bg-primary-foreground" : "bg-success"),
          page.status === "processing" && "bg-primary animate-pulse-soft",
          page.status === "error" && "bg-destructive",
          page.status === "pending" && "bg-border-strong",
        )}
      />
      <span className="num">p{page.pageNumber.toString().padStart(2, "0")}</span>
      {page.status === "done" && page.instances.length > 0 && (
        <span className={cn("num text-[10px]", active ? "opacity-80" : "text-foreground/80")}>
          ·{page.instances.length.toString().padStart(2, "0")}
        </span>
      )}
    </button>
  );
}

function StatusChip({ status }: { status: JobResult["status"] }) {
  const label = status === "complete" ? "OK"
    : status === "partial" ? "PARTIAL"
    : status === "error" ? "ERR"
    : status === "processing" ? "WORKING"
    : "QUEUED";
  const styles = {
    queued: "border-border-strong text-muted-foreground",
    processing: "border-primary text-primary",
    complete: "border-success text-success",
    partial: "border-primary text-primary",
    error: "border-destructive text-destructive",
  }[status];
  return (
    <span className={cn(
      "font-mono text-[9px] uppercase tracking-wider2 px-1.5 py-px border rounded-sm shrink-0",
      styles,
    )}>
      [{label}]
    </span>
  );
}

function GhostButton({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-sm font-mono text-[10px] uppercase tracking-wider2 border transition-all",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-border-strong",
      )}
    >
      {children}
    </button>
  );
}

function GhostLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm font-mono text-[10px] uppercase tracking-wider2 border border-border text-muted-foreground hover:text-foreground hover:border-border-strong transition-all"
    >
      {children}
    </a>
  );
}

function IconBtn({
  children, onClick, disabled, title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 hover:bg-surface-2 transition-colors disabled:opacity-25 disabled:cursor-not-allowed text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
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
    <div className="border-t border-border bg-surface p-3 shrink-0 max-h-[40%] overflow-y-auto scrollbar-thin">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="font-mono text-[10px] uppercase tracking-wider2 text-primary">Spot-check</h3>
        <span className="flex-1 h-px bg-border" />
      </div>
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="text-muted-foreground/70 text-[10px] uppercase tracking-wider2">
            <th className="text-left font-normal pb-1.5">Code</th>
            <th className="text-right font-normal pb-1.5">Found</th>
            <th className="text-right font-normal pb-1.5">Expected</th>
          </tr>
        </thead>
        <tbody>
          {job.codes.map((c) => {
            const exp = expected[c.code];
            const mismatch = exp != null && exp !== c.count;
            return (
              <tr key={c.code} className={cn("transition-colors", mismatch && "text-destructive")}>
                <td className="py-1">{c.code}</td>
                <td className="text-right tabular-nums py-1">{c.count}</td>
                <td className="text-right py-1">
                  <input
                    type="number"
                    min={0}
                    value={exp ?? ""}
                    onChange={(e) => update(c.code, e.target.value)}
                    className="w-12 bg-background border border-border rounded-sm px-1 text-right tabular-nums focus:outline-none focus:border-primary"
                  />
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
  return `hsl(${hue} 78% 58%)`;
}
