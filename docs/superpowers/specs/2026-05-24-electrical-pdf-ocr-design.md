# Electrical PDF OCR — Design Spec

**Date:** 2026-05-24
**Status:** Approved, ready for implementation plan
**Owner:** Rohan
**Context:** Take-home assignment from Jesse Choe

## Problem

Jesse sent an electrical lighting plan PDF and a brief: "OCR the drawing and generate bounding boxes around those codes" (LF1, LF2, ..., LF15). Build a "good looking web app UI that allows me to upload PDFs and returns the results (a Vercel link)." Jesse will test multiple PDFs.

The technical task: for every page of an uploaded PDF, return a list of `{code, x, y, width, height}` records that the UI uses to draw rectangles over a rendered image of the page.

## Goals

1. Accurately detect every instance of code-style labels (LF1, LF2, ..., LF7-X, etc.) on engineering drawings
2. Generalize to PDFs with different code prefixes (P# for power, RC# for receptacles, etc.) — auto-discover the code set from the PDF's own legend
3. Deliver a polished, interactive web app deployed to Vercel that Jesse can demo via shareable link
4. Support PDFs with mixed content (drawings, schedules, reference sheets) — only annotate the drawing pages with code labels

## Non-goals (v1)

- Authentication / user accounts
- Long-term storage / cleanup of uploaded PDFs
- Custom user-defined regex for code patterns
- Handwritten annotation OCR
- OCR engine failover (Google Vision down = app down)
- PDF deduplication via content hash

## Empirical evidence backing the OCR choice

Tested on Jesse's PDF (page 2, electrical lighting plan, 500 DPI, 35 tiles):

| Engine | Hits | Unique codes | Codes missed | Wall time |
|---|---|---|---|---|
| Tesseract (local) | 43 | 12 | LF3, LF5, LF13 | <5s |
| EasyOCR (local) | 26 | 13 | LF4, LF5, LF10, LF11 | ~60s |
| **Google Vision DOCUMENT_TEXT_DETECTION** | **109** | **18** | **none** | **~17s** |
| Azure Document Intelligence Read | 105 | 19 (+LF7-X) | none | ~5 min (F0 rate limit) |

Conclusion: Google Vision and Azure are essentially tied on accuracy; Google is 15× faster on free tier; Google has the bigger free tier (1000/mo vs 500/mo). The single Azure win (LF7-X read as one token vs Google's LF7+X split) is fixable in post-processing.

**Locked: Google Cloud Vision `DOCUMENT_TEXT_DETECTION`.**

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Next.js frontend)                                  │
│  Upload page → Results page (viewer + sidebar)               │
└────────────┬───────────────────────────────────▲─────────────┘
             │                                   │
             ▼                                   │
┌──────────────────────────────────────────────────────────────┐
│  Vercel Serverless Functions (Next.js API routes)            │
│  /api/upload  /api/process  /api/result/[id]                 │
│  /api/export-pdf  /api/export-json                           │
└────────────┬─────────────────────────────────┬───────────────┘
             │                                 │
             ▼                                 ▼
   ┌──────────────────────┐         ┌──────────────────────┐
   │ Google Cloud Vision  │         │ Vercel Blob Storage  │
   │ + Claude Sonnet 4.6  │         │ (PDFs + page images  │
   │ (legend discovery)   │         │  + result JSON)      │
   └──────────────────────┘         └──────────────────────┘
```

**Design principles:**
- Async + polling (not synchronous request/response) — sidesteps Vercel function timeouts on multi-page PDFs
- Blob storage as the only state store — no database in v1
- jobId as UUIDv4 — unguessable, shareable URLs
- All processing server-side; browser only uploads and renders

## Backend OCR pipeline (the core)

```
PDF (Blob URL)
  → 1. Render pages to PNG at 500 DPI (pdfjs-dist)
  → 2. Tile each page into 3000×3000 px chunks with 200px overlap
  → 3. Send tiles to Google Vision (max 5 concurrent per page,
       max 3 concurrent pages → respects Vercel function limits)
  → 4. Translate per-tile bbox coords to page-space coords
  → 5. Discover the legend code list via Claude Sonnet 4.6 vision
       (one call per PDF, ~$0.01, sent right-25% strip of page 2)
  → 6. Post-process & filter:
       a) Normalize em-dash → hyphen
       b) Merge adjacent LF7 + X tokens → LF7-X (fixes the Azure-edge gap)
       c) Regex pre-filter: ^[A-Z]{1,4}\d+(-\w+)?$
       d) Exact-match filter against discovered legend codes
  → 7. Dedupe across tile overlaps (IoU > 0.4, same code → keep higher conf)
  → Result JSON written to Blob
```

**Result JSON shape:**
```typescript
{
  jobId: string,
  status: "queued" | "processing" | "complete" | "partial" | "error",
  pdfName: string,
  processedAt: ISO8601,
  ocrEngine: "google-vision",
  meta: { totalPages: number, totalHits: number },
  pages: [{
    pageNumber: number,
    width: number, height: number,
    imageUrl: string,
    status: "pending" | "processing" | "done" | "error",
    instances: [{ code: string, x: number, y: number, w: number, h: number, conf: number }],
    errors?: string[]
  }],
  codes: [{ code: string, description: string, count: number, color: string }]
}
```

## Frontend (functional spec)

Visual aesthetic, typography, and motion are deferred to the **frontend-design skill** during the build phase. This section defines features and screens only.

### Screens

**1. Upload page (`/`)**
- Drag-and-drop zone (also click-to-browse) accepting `.pdf`, max 50MB
- Upload progress bar
- "Recent uploads" list (last 5, stored in `localStorage`)
- On success → POST `/api/upload` → get `jobId` → redirect to `/results/[jobId]`

**2. Results page (`/results/[jobId]`)**

Two-pane layout (left ~70%, right ~30%):

Left pane (viewer):
- One page at a time, fit-to-width by default
- Bbox overlay layer: absolutely-positioned divs, one per instance, border in the code's color
- Hover: tooltip shows code + description from legend
- Click a box: highlights all instances of that code; others fade. Click again to deselect
- Zoom: +/- buttons, mousewheel, pan-with-drag (`react-zoom-pan-pinch`)
- Page navigation: prev/next + page picker at bottom
- Processing state: per-page progress badges ("Page 1 ✓ · Page 2 ⟳ · Page 3 ⏳")

Right pane (sidebar):
- Code list: color swatch · code · count · "view in legend" mini-link
- Search/filter input at top ("show only LF7*")
- Each row clickable → highlights that code's instances
- Color assignment: deterministic — `hash(code) → HSL hue`
- Low-confidence (<0.7) instances flagged with ⚠ on the row

Top bar:
- PDF filename · processed timestamp · OCR engine name
- Export buttons: `Download annotated PDF`, `Download JSON`
- Share button: copy `/results/[jobId]` URL

**3. Spot-check mode (toggle on results page)**
- For each code, shows: found count vs expected count (if user has entered expected)
- Editable "expected count" field per code; mismatches highlighted in red
- Useful for Jesse to verify expected vs found at a glance

**4. Side-by-side compare (`/compare?a=jobId1&b=jobId2`)**
- Two viewers stacked or side-by-side
- Code list shows: A count | B count | delta
- Useful for comparing revisions of the same drawing

### Polish features (all included in v1)

- Color-coded boxes (deterministic per code)
- Click-to-jump in legend (click a code → viewer scrolls to first instance)
- Keyboard shortcuts (←/→ = page nav, `f` = fit-to-width, digit = toggle code N)
- Per-page processing progress (streaming as pages complete)
- Spot-check mode
- Side-by-side compare mode
- Annotated PDF export (boxes burned in via `pdf-lib`)
- JSON export

## Data flow

```
1. UPLOAD
   Browser → POST /api/upload (file)
   API: validate, store PDF in /pdfs/<jobId>.pdf, create stub /results/<jobId>.json
   API: kick off /api/process asynchronously
   API → Browser: { jobId }
   Browser → redirect to /results/<jobId>

2. PROCESS (async, on the server)
   /api/process(jobId):
     fetch PDF
     render all pages (pdfjs-dist)
     store images in /pages/<jobId>/p<N>.png
     for each page (max 3 concurrent):
       tile
       for each tile (max 5 concurrent):
         Google Vision call (with retry: 1s, 2s, 4s)
         translate coords
       dedupe overlaps
       update result.json (page status = "done", push instances)
     call Claude vision once for legend discovery
     post-process (normalize, merge LF7+X, filter)
     mark result.json status = "complete"

3. VIEW
   Browser GET /results/<jobId> → Next.js Server Component reads result.json
   While status != "complete": poll /api/result/<jobId> every 2s
   Frontend renders pages as their status flips to "done"

4. EXPORT (on-demand)
   GET /api/export-pdf/<jobId> → pdf-lib annotates source PDF, streams response
   GET /api/export-json/<jobId> → stream result.json

5. SHARE
   /results/<jobId> URL works for anyone (no auth in v1)
   jobId is UUIDv4 → unguessable
```

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Vercel-native, server components, file routing |
| Language | TypeScript | Catches bbox-math bugs before they ship |
| PDF rendering | `pdfjs-dist` | Pure JS, no native deps, Vercel-compatible |
| Image manipulation | `sharp` | Tiling, encoding; Vercel auto-bundles binary |
| OCR | `@google-cloud/vision` | Locked engine |
| Legend discovery | `@anthropic-ai/sdk` (Sonnet 4.6 vision) | One call per PDF |
| Annotated PDF export | `pdf-lib` | Pure JS, can add rect annotations |
| State storage | `@vercel/blob` | Files + result JSON |
| UI components | shadcn/ui + Tailwind | Standard; styled by frontend-design skill |
| Viewer pan/zoom | `react-zoom-pan-pinch` | Tiny, works well |
| Frontend aesthetic | TBD by frontend-design skill | Color system, type, motion |

## Deployment

- **Vercel Pro tier** ($20/mo) — required for `maxDuration: 300` on `/api/process`
- **Region:** `iad1` (sensible default)
- **Env vars:**
  - `GOOGLE_APPLICATION_CREDENTIALS_JSON` — *contents* of the service account JSON (not path); function writes to `/tmp/sa.json` on cold start
  - `ANTHROPIC_API_KEY`
  - `BLOB_READ_WRITE_TOKEN` (auto-set by Vercel when Blob is enabled)
- **Vercel Blob:** enabled via dashboard → Storage → Create → Blob
- **CI:** GitHub → Vercel auto preview per PR, prod deploy per merge to `main`. No blocking tests for v1.

## Edge cases handled

| Case | Handling |
|---|---|
| Em-dash in OCR (`LF7—X`) | Normalize to hyphen before regex |
| Token split (`LF7` + `X`) | Post-process merge of adjacent tokens within 50px |
| Look-alike misread (`LF15` → `LF1S`) | Filtered out by exact-match against legend codes |
| Same instance in two overlap tiles | IoU > 0.4 + same code → keep higher confidence |
| Distractor codes (`B#9`, `OS`, `EM`) | Excluded by regex + exact-match filter |
| Rotated labels | Google Vision reads them; bbox is loose; acceptable |
| PDF >50MB | Reject at upload with friendly error |
| Encrypted/corrupt PDF | Detect at render, return error |
| Vision API 429/5xx | Exponential backoff, 3 retries, then skip tile with error in result |
| Claude legend discovery fails | Fall back to regex-only filter (`^[A-Z]{1,4}\d+(-\w+)?$`) |
| Process timeout (>300s) | Save partial result with `status: "partial"`; UI shows banner |
| Blob write fails | Return 500; frontend shows retry button |
| Concurrent uploads | Each has unique jobId; fully isolated |
| Same PDF re-uploaded | New jobId; no content-hash dedup in v1 |

## Observability

- All `/api/process` invocations log structured events: `{jobId, page, tile, durationMs, hitCount, errors[]}`
- Vercel logs UI is sufficient for v1
- Optional: Sentry for uncaught errors (one env var to add)

## Cost per PDF processed

| Component | Cost |
|---|---|
| Vercel Blob storage | ~$0 (small files) |
| Vercel function compute | ~$0.005 (50 invocations) |
| Google Vision OCR | ~$0.37 (245 calls @ $1.50/1000) — **free for first 1000/month** |
| Claude Sonnet 4.6 vision | ~$0.01 (1 small call) |
| **Total** | **~$0.02/PDF after Vision free tier exhausted** |

## Estimated build time

| Phase | Hours |
|---|---|
| Backend pipeline (render, tile, OCR, dedup) | 3-4 |
| Legend discovery via Claude vision | 1 |
| Frontend upload + results pages (functional) | 2-3 |
| UI extras (color, click-jump, keyboard, progress) | 2-3 |
| Spot-check + side-by-side compare | 2-3 |
| Annotated PDF export | 1-2 |
| frontend-design skill polish pass | 3-4 |
| Deployment, env vars, end-to-end test | 1-2 |
| **Total** | **15-22 hours** |

## Out of scope (v2 candidates)

- Authentication / user accounts (NextAuth + Postgres)
- PDF deletion cron (cleanup after 30 days)
- Custom user-defined regex per upload
- OCR engine failover (Azure as backup)
- Handwritten annotation OCR
- Content-hash dedup of re-uploaded PDFs
- Observability dashboards (Axiom, Datadog)

## References

- Empirical comparison script: `C:\Users\Chint\Downloads\ocr_test\compare_engines.py`
- Test PDF: `C:\Users\Chint\Downloads\ELECTRICAL (2) (1).pdf`
- Google service account: `C:\Users\Chint\Downloads\electrical-pdf-ocr-29b409a16e6d.json`
- Azure resource: `electrical-ocr-rohan` in `ocr-rg` (East US) — kept for v2 failover option
