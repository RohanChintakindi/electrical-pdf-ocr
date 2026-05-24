// Burn bbox rectangles onto the source PDF and stream it back.
import { NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";
import { readJob } from "@/lib/jobs";
import { getBytes } from "@/lib/blob";
// Inline the DPI constant — importing pdf-render here would drag pdfjs/sharp
// into this route's bundle.
const RENDER_DPI = 500;

export const runtime = "nodejs";
export const maxDuration = 60;

function codeColorRGB(code: string): [number, number, number] {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  const hue = (Math.abs(h) % 360) / 360;
  // HSL(0.85, 0.45) → RGB
  return hslToRgb(hue, 0.85, 0.45);
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdfBytes = await getBytes(job.pdfUrl);
  if (!pdfBytes) return NextResponse.json({ error: "Source PDF missing" }, { status: 404 });

  const doc = await PDFDocument.load(pdfBytes);
  const pages = doc.getPages();
  const pxPerPt = RENDER_DPI / 72;
  for (const p of job.pages) {
    const page = pages[p.pageNumber - 1];
    if (!page) continue;
    const pageH = page.getHeight();
    for (const inst of p.instances) {
      const [r, g, b] = codeColorRGB(inst.code);
      const xPt = inst.x / pxPerPt;
      const wPt = inst.w / pxPerPt;
      const hPt = inst.h / pxPerPt;
      // PDF coords are bottom-up; image coords are top-down
      const yPt = pageH - inst.y / pxPerPt - hPt;
      page.drawRectangle({
        x: xPt - 2,
        y: yPt - 2,
        width: wPt + 4,
        height: hPt + 4,
        borderColor: rgb(r, g, b),
        borderWidth: 1.2,
        opacity: 0.0,
        borderOpacity: 1,
      });
    }
  }
  const out = await doc.save();
  const safeName = job.pdfName.replace(/\.pdf$/i, "");
  return new NextResponse(Buffer.from(out), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safeName}-annotated.pdf"`,
    },
  });
}
