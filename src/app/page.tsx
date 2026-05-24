import UploadDropzone from "@/components/UploadDropzone";
import ClearBlobsPanel from "@/components/ClearBlobsPanel";

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Atmospheric layers */}
      <div className="pointer-events-none absolute inset-0 bg-draft-grid opacity-[0.55]" />
      <div className="pointer-events-none absolute inset-0 bg-hero-glow" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

      {/* Drafting registration marks on the page corners */}
      <CornerMark className="top-5 left-5" />
      <CornerMark className="top-5 right-5" rotate={90} />
      <CornerMark className="bottom-5 right-5" rotate={180} />
      <CornerMark className="bottom-5 left-5" rotate={270} />

      {/* Header strip — like a CAD title block */}
      <header className="relative z-10 px-6 sm:px-10 pt-6 flex items-center justify-between text-[10px] uppercase tracking-wider2 text-muted-foreground font-mono">
        <div className="flex items-center gap-2">
          <span className="inline-block size-1.5 rounded-full bg-primary animate-pulse-soft" />
          <span>Electrical.OCR</span>
          <span className="text-border-strong">/</span>
          <span>v1.0</span>
          <span className="text-border-strong">/</span>
          <span className="text-foreground/70">System online</span>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <span>UTC {new Date().toISOString().slice(0, 10)}</span>
          <span className="text-border-strong">·</span>
          <a
            href="https://github.com/RohanChintakindi/electrical-pdf-ocr"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground transition-colors"
          >
            Source
          </a>
        </div>
      </header>

      <div className="relative z-10 max-w-6xl mx-auto px-6 sm:px-10 pt-16 sm:pt-24 pb-16">
        {/* Hero */}
        <section className="grid grid-cols-12 gap-y-10 sm:gap-x-10 items-end">
          <div className="col-span-12 lg:col-span-7">
            <p className="font-mono text-[11px] uppercase tracking-wider2 text-primary mb-5 flex items-center gap-2">
              <span className="inline-block w-6 h-px bg-primary" />
              Drawing intelligence
            </p>
            <h1 className="font-display text-[44px] sm:text-[68px] leading-[0.98] tracking-[-0.02em] text-foreground">
              Read the{" "}
              <span className="italic font-normal text-primary">
                schedule.
              </span>
              <br />
              Count every <span className="italic font-normal">fixture.</span>
            </h1>
            <p className="mt-6 text-base sm:text-lg text-muted-foreground max-w-xl leading-relaxed">
              Drop an engineering PDF. We read it like an electrician would —
              find the lighting schedule, learn every code, and box every
              instance on the plan.
            </p>
          </div>

          <div className="col-span-12 lg:col-span-5 lg:pl-6">
            <div className="grid grid-cols-3 gap-px bg-border rounded-md overflow-hidden">
              <Stat k="01" v="OCR" sub="Google Vision" />
              <Stat k="02" v="LLM" sub="Claude legend" />
              <Stat k="03" v="60s" sub="Typical job" />
            </div>
          </div>
        </section>

        {/* Dimension line */}
        <div className="mt-14 dim-line h-3" />

        {/* Upload + workflow */}
        <section className="mt-12 grid grid-cols-12 gap-10">
          <div className="col-span-12 lg:col-span-8">
            <UploadDropzone />
          </div>

          <aside className="col-span-12 lg:col-span-4">
            <p className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground mb-5">
              Pipeline
            </p>
            <ol className="space-y-5">
              <Step
                n="01"
                title="Render"
                body="Each page rasterized at 500 DPI in a serverless worker."
              />
              <Step
                n="02"
                title="Detect"
                body="Tiled OCR with Google Vision — small text stays sharp."
              />
              <Step
                n="03"
                title="Legend"
                body="Claude 4.6 reads the schedule table on each page."
              />
              <Step
                n="04"
                title="Filter"
                body="Hits matched to legend codes — junk OCR is dropped."
              />
            </ol>

            <ClearBlobsPanel />
          </aside>
        </section>
      </div>

      {/* Footer fineprint */}
      <footer className="relative z-10 border-t border-border/60 mt-10">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-5 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider2 text-muted-foreground">
          <span>Sheet 01 / 01 · Drawing intelligence</span>
          <span>Scale: 1 : 1 · DPI 500</span>
        </div>
      </footer>
    </main>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="bg-surface px-4 py-5">
      <div className="font-mono text-[10px] uppercase tracking-wider2 text-muted-foreground">{k}</div>
      <div className="mt-1 font-display text-2xl text-foreground">{v}</div>
      <div className="font-mono text-[10px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-4 group">
      <span className="font-mono text-[10px] text-primary tracking-wider2 pt-1.5 w-7 shrink-0">{n}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-lg text-foreground">{title}</h3>
          <span className="flex-1 h-px bg-border group-hover:bg-border-strong transition-colors" />
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </li>
  );
}

function CornerMark({ className, rotate = 0 }: { className?: string; rotate?: number }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      className={`absolute z-0 text-border-strong ${className ?? ""}`}
      style={{ transform: `rotate(${rotate}deg)` }}
      aria-hidden="true"
    >
      <path d="M0 12 L12 12 L12 0" stroke="currentColor" strokeWidth="1" fill="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  );
}
