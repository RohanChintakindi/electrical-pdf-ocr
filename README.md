# Electrical PDF OCR

Upload an engineering drawing PDF, get bounding boxes around every fixture code (LF1, LF7-X, P3, etc.). Designed for electrical lighting/power plans; works on any PDF with a code legend.

## Stack

- Next.js 16 (App Router) + TypeScript
- Google Cloud Vision DOCUMENT_TEXT_DETECTION for OCR
- Claude Sonnet 4.6 vision for legend auto-discovery
- `pdfjs-dist` (legacy/node build) + `@napi-rs/canvas` for page rasterization
- `sharp` for tile crops, `pdf-lib` for annotated-PDF export
- Vercel Blob for state (PDFs, page images, result JSON); local-disk fallback for dev

## How it works

```
PDF → render every page at 500 DPI → tile into 3000×3000 px chunks with 200 px overlap
    → Google Vision per tile (concurrency cap 5/page, 3/upload)
    → merge LF7+X token splits → IoU 0.4 dedupe across tiles
    → Claude vision discovers the legend code list (right-25% strip of largest page)
    → filter hits by legend codes
    → write result.json + page PNGs to Blob
Browser polls /api/result/[jobId] every 2s and renders boxes as pages complete.
```

## Local dev

```powershell
npm install
# Either set the path:
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:ANTHROPIC_API_KEY = "sk-ant-..."
# Or put them in .env.local (see .env.example)
npm run dev
```

Open <http://localhost:3000> (or whichever port Next picks if 3000 is busy).

## Deploy to Vercel

1. `vercel link` then `vercel`
2. In the Vercel dashboard, add env vars:
   - `GOOGLE_APPLICATION_CREDENTIALS_JSON` — paste the full JSON contents (not the path)
   - `ANTHROPIC_API_KEY`
3. Storage → Blob → Create. `BLOB_READ_WRITE_TOKEN` is auto-set.
4. Pro tier required for `maxDuration: 300` on `/api/process`.

## Output JSON

```ts
{
  jobId: string,
  status: "queued" | "processing" | "complete" | "partial" | "error",
  pdfName: string,
  pdfUrl: string,
  processedAt: ISO8601,
  ocrEngine: "google-vision",
  meta: { totalPages, totalHits, durationMs },
  pages: [{
    pageNumber, width, height, imageUrl,
    status: "pending" | "processing" | "done" | "error",
    instances: [{ code, x, y, w, h, conf }],
    errors?: string[]
  }],
  codes: [{ code, description, count, color }]
}
```

## Frontend features

- Drag-drop upload, 50 MB max
- Two-pane results view: image + bbox overlays / code sidebar
- Per-page progress (page badges flip from pending → processing → done as work completes)
- Click a box or sidebar row to highlight all instances of one code
- Search/filter codes (`LF7*` wildcards)
- Show/hide per-code toggle
- Spot-check mode (expected vs. found, persisted to `localStorage`)
- Side-by-side compare (`/compare?a=jobId1&b=jobId2`)
- Annotated PDF + JSON export
- Keyboard shortcuts: ← / → pages, `f` reset zoom, `1-9` toggle code N

## Design doc

See `docs/superpowers/specs/2026-05-24-electrical-pdf-ocr-design.md` for the full spec.
