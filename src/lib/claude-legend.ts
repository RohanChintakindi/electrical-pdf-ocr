// One-shot legend extraction. We send the right ~25% of a representative page to
// Claude Sonnet 4.6 vision and ask for the canonical code list with descriptions.
// Returns [] on any failure (caller falls back to regex-only filter).
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";

export interface LegendEntry {
  code: string;
  description: string;
}

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

const MAX_EDGE = 3072;

async function downsizedFull(pageBuf: Buffer): Promise<Buffer> {
  // 3072 long-edge: enough resolution for the small schedule text to stay
  // readable, but well under Claude's 8000px limit so token cost stays sane.
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

const SYS_PROMPT = `You are an OCR-aware engineering-drawing assistant. The user will show you a page from an electrical engineering drawing. Some pages contain a "lighting fixture schedule", "luminaire schedule", "fixture legend", "symbols schedule", or similar table that lists fixture/equipment codes (e.g. LF1, LF2, LF7-X, P1, RC1) with descriptions.

Return ONLY a JSON object with this exact shape, no prose:
{ "codes": [ { "code": "LF1", "description": "2x2 LED Recessed Troffer" }, ... ] }

Rules:
- Look anywhere on the page for a schedule/legend/table that maps a code-style label to a description. It may be on the right edge, in a corner, in the middle, or be the whole page.
- Include EVERY code-style label (1-4 capital letters + digits + optional -suffix like -X, -4, -6, -8) that appears as a row in such a schedule.
- Code text exactly as printed (preserve case).
- Description: short, the main text the schedule shows next to the code (manufacturer + type is fine). Empty string if not clear.
- If this page has NO schedule/legend table at all, return { "codes": [] }.
- Do NOT include codes that only appear as call-outs in the drawing itself — only entries that are explicitly listed in a schedule/legend table.
- Never invent codes. Only return what you can actually read.`;

export async function discoverLegend(pageBuf: Buffer, _pageW: number, _pageH: number): Promise<LegendEntry[]> {
  try {
    const client = await getClient();
    const fullPng = await downsizedFull(pageBuf);
    const b64 = fullPng.toString("base64");
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYS_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
            { type: "text", text: "Extract every code from this legend. Return JSON only." },
          ],
        },
      ],
    });
    const text = resp.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as { codes?: LegendEntry[] };
    return parsed.codes ?? [];
  } catch (e) {
    console.error("[legend] discovery failed:", e);
    return [];
  }
}
