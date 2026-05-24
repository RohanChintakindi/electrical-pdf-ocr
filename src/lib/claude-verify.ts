// Post-OCR verification pass: ask Claude Sonnet to look at each page and find
// fixture-code labels Google Vision missed. Vision misses text that's blended
// into dimension lines, occluded by symbols, or tightly kerned. Claude vision
// reads those because it has stronger context priors.
//
// Returns approximate normalized bboxes which we scale back to page pixels.
// Bbox accuracy is loose (~5-10% of page dim) — fine for click-to-zoom UX,
// not surveying. The count is what matters for recall.
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import type { Instance } from "./types";

let clientPromise: Promise<Anthropic> | null = null;
async function getClient(): Promise<Anthropic> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!clientPromise) {
    clientPromise = (async () => {
      const mod = await import("@anthropic-ai/sdk");
      return new mod.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    })();
  }
  return clientPromise;
}

// 2048 long-edge: enough to read small fixture labels, low enough to keep
// per-page token cost ~$0.01-0.02 on Sonnet.
const MAX_EDGE = 2048;

async function downsizeForVerify(pageBuf: Buffer): Promise<Buffer> {
  const img = sharp(pageBuf);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (Math.max(w, h) <= MAX_EDGE) return img.png().toBuffer();
  if (w >= h) {
    return img.resize({ width: MAX_EDGE, withoutEnlargement: true }).png().toBuffer();
  }
  return img.resize({ height: MAX_EDGE, withoutEnlargement: true }).png().toBuffer();
}

const SYS_PROMPT = `You audit OCR output on electrical engineering drawings. The user gives you:
- A page image (downsized for context window)
- A list of fixture codes from the legend, with descriptions
- A list of already-detected instances on this page with normalized bboxes (0-1, top-left origin)

Your job: find any visible label of a legend code on the page that is NOT already in the detected list. Return JSON only:
{ "missed": [ { "code": "LF7-8", "x": 0.234, "y": 0.567, "w": 0.04, "h": 0.015 } ] }

Rules:
- Coordinates normalized 0-1 relative to the image, (x,y) is top-left of the label box
- Be CONSERVATIVE. Only report if you can READ the code text on the image AND you do not see a detected box within ~3% of its position with the same code
- A label like "LF7-8", "L7-8" (F obscured), or "F7-8" (L cropped) all count as LF7-8 if LF7-X or LF7-8 is in the legend
- Wildcard codes: a legend entry ending in -X (e.g. LF7-X) means LF7 with any -suffix. Report the actual suffix you see (LF7-4, LF7-6, LF7-8) not the wildcard
- If a label's code is NOT in the legend list, do not include it
- If nothing is missed, return { "missed": [] }
- Do not invent labels — only report what is visibly printed on the page
- Hard cap: do not return more than 60 missed instances per page (avoid runaway hallucination)`;

export interface VerifyDetected {
  code: string;
  // normalized 0-1, top-left origin
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VerifyResult {
  added: Instance[];
  rawReturned: number;
  rejected: number;
  durationMs: number;
  error?: string;
}

export async function verifyPage(args: {
  pageBuf: Buffer;
  pageW: number;
  pageH: number;
  legendCodes: { code: string; description: string }[];
  detected: Instance[];
  resolveCode: (code: string) => string | null;
}): Promise<VerifyResult> {
  const { pageBuf, pageW, pageH, legendCodes, detected, resolveCode } = args;
  const started = Date.now();
  try {
    const client = await getClient();
    const png = await downsizeForVerify(pageBuf);
    const b64 = png.toString("base64");

    const legendText = legendCodes
      .map((l) => `- ${l.code}: ${l.description || "(no description)"}`)
      .join("\n");

    // Normalize detected bboxes to 0-1 so coords are consistent with Claude's output
    const detectedNorm = detected.map((d) => ({
      code: d.code,
      x: +(d.x / pageW).toFixed(3),
      y: +(d.y / pageH).toFixed(3),
      w: +(d.w / pageW).toFixed(3),
      h: +(d.h / pageH).toFixed(3),
    }));

    const userText =
      `Legend codes (canonical names + descriptions):\n${legendText}\n\n` +
      `Already detected on this page (normalized 0-1, top-left origin):\n${JSON.stringify(detectedNorm)}\n\n` +
      `Find any visible label of a legend code that is NOT in the detected list. JSON only.`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYS_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
            { type: "text", text: userText },
          ],
        },
      ],
    });

    const text = resp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { added: [], rawReturned: 0, rejected: 0, durationMs: Date.now() - started };
    let parsed: { missed?: VerifyDetected[] };
    try {
      parsed = JSON.parse(match[0]) as { missed?: VerifyDetected[] };
    } catch (e: any) {
      return { added: [], rawReturned: 0, rejected: 0, durationMs: Date.now() - started, error: `parse: ${e.message}` };
    }
    const missed = (parsed.missed ?? []).slice(0, 60);

    const added: Instance[] = [];
    let rejected = 0;
    for (const m of missed) {
      if (!m.code || typeof m.x !== "number" || typeof m.y !== "number") { rejected++; continue; }
      const canonical = resolveCode(String(m.code).toUpperCase());
      if (!canonical) { rejected++; continue; }
      // Bbox sanity check: must be within page bounds and not absurdly large
      const x = Math.max(0, Math.min(1, m.x));
      const y = Math.max(0, Math.min(1, m.y));
      const w = Math.max(0.005, Math.min(0.15, m.w ?? 0.03));
      const h = Math.max(0.005, Math.min(0.05, m.h ?? 0.015));
      // Reject if it overlaps an existing detection of the same code by IoU > 0.3
      const overlaps = detected.some((d) => {
        if (d.code !== canonical) return false;
        const ax1 = x * pageW, ay1 = y * pageH, ax2 = ax1 + w * pageW, ay2 = ay1 + h * pageH;
        const bx1 = d.x, by1 = d.y, bx2 = d.x + d.w, by2 = d.y + d.h;
        const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
        const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
        if (ix2 <= ix1 || iy2 <= iy1) return false;
        const inter = (ix2 - ix1) * (iy2 - iy1);
        const union = (ax2 - ax1) * (ay2 - ay1) + d.w * d.h - inter;
        return union > 0 && inter / union > 0.3;
      });
      if (overlaps) { rejected++; continue; }
      added.push({
        code: canonical,
        x: x * pageW,
        y: y * pageH,
        w: w * pageW,
        h: h * pageH,
        conf: 0.7,
      });
    }

    return { added, rawReturned: missed.length, rejected, durationMs: Date.now() - started };
  } catch (e: any) {
    console.error("[verify] failed:", e?.message ?? e);
    return { added: [], rawReturned: 0, rejected: 0, durationMs: Date.now() - started, error: e?.message ?? String(e) };
  }
}
