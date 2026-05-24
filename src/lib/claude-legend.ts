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

async function rightStrip(pageBuf: Buffer, pageW: number, pageH: number, ratio = 0.28): Promise<Buffer> {
  const left = Math.floor(pageW * (1 - ratio));
  const width = pageW - left;
  // Downsize so we don't blow up the API payload — long edge max 2048px is plenty
  const cropped = sharp(pageBuf).extract({ left, top: 0, width, height: pageH });
  const meta = await cropped.metadata();
  if ((meta.width ?? 0) > 2048 || (meta.height ?? 0) > 2048) {
    return cropped.resize({ width: Math.min(2048, meta.width ?? 2048), withoutEnlargement: true }).png().toBuffer();
  }
  return cropped.png().toBuffer();
}

const SYS_PROMPT = `You are an OCR-aware engineering-drawing assistant. The user will show you a CROP from an engineering drawing. The crop is likely to contain a "lighting fixture schedule" or similar legend that lists fixture/equipment codes (e.g. LF1, LF2, LF7-X, P1, RC1) and their descriptions.

Return ONLY a JSON object with this exact shape, no prose:
{ "codes": [ { "code": "LF1", "description": "2x2 LED Recessed Troffer" }, ... ] }

Rules:
- Include EVERY code-style label (1-4 capital letters + digits + optional -suffix) that appears in the legend.
- Code text exactly as printed.
- Description: short, what the legend says next to the code. Empty string if not clear.
- If the crop has no legend at all, return { "codes": [] }.
- Never invent codes. Only return what you can actually read.`;

export async function discoverLegend(pageBuf: Buffer, pageW: number, pageH: number): Promise<LegendEntry[]> {
  try {
    const client = await getClient();
    const stripPng = await rightStrip(pageBuf, pageW, pageH);
    const b64 = stripPng.toString("base64");
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
