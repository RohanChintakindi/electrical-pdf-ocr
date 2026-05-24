// Google Cloud Vision DOCUMENT_TEXT_DETECTION wrapper.
// Reads creds from GOOGLE_APPLICATION_CREDENTIALS_JSON (contents) or GOOGLE_APPLICATION_CREDENTIALS (path).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ImageAnnotatorClient } from "@google-cloud/vision";
import type { RawHit } from "./types";

const NORMALIZE: Record<string, string> = { "—": "-", "–": "-", "‐": "-", "‒": "-", "−": "-" };
function normalize(s: string): string {
  let out = "";
  for (const ch of s) out += NORMALIZE[ch] ?? ch;
  // Collapse runs of hyphens (e.g. "LF7--8" from a long PDF dash mis-OCRed
  // as two ASCII hyphens) into a single hyphen so the canonical code-shape
  // regex catches it.
  out = out.replace(/-{2,}/g, "-");
  return out.trim();
}

// ^[A-Z]{1,4}\d+(-\w+)?$ — generic code shape: 1-4 caps, digits, optional -suffix
const CODE_RE = /^[A-Z]{1,4}\d+(-\w+)?$/;
// Same shape, used to extract *substrings* from tokens that contain extra
// noise (e.g. "LF11B#5" packs LF11 next to a circuit number). The `g` flag
// is required for matchAll.
const CODE_EXTRACT_RE = /[A-Z]{1,4}\d+(?:-\w+)?/g;

let clientPromise: Promise<ImageAnnotatorClient> | null = null;

async function getClient(): Promise<ImageAnnotatorClient> {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const mod = await import("@google-cloud/vision");
    const inlineJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (inlineJson) {
      const creds = JSON.parse(inlineJson);
      return new mod.ImageAnnotatorClient({ credentials: creds, projectId: creds.project_id });
    }
    const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credsPath && fs.existsSync(credsPath)) {
      return new mod.ImageAnnotatorClient({ keyFilename: credsPath });
    }
    throw new Error("Google Vision credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
  })();
  return clientPromise;
}

export interface VisionWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

async function callVisionWithRetry(png: Buffer, attempts = 3): Promise<any> {
  const client = await getClient();
  let delay = 1000;
  let lastErr: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const [resp] = await client.documentTextDetection({ image: { content: png } });
      if (resp.error?.message) throw new Error(resp.error.message);
      return resp;
    } catch (e: any) {
      lastErr = e;
      const code = e?.code;
      const retriable = code === 14 || code === 4 || code === 8 || /429|5\d\d/.test(String(e?.message));
      if (i === attempts - 1 || !retriable) throw e;
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw lastErr;
}

// Extract every word + its bbox. Uses a substring regex so a token like
// "LF11B#5" yields both LF11 and B5 as separate hits (the bbox is interpolated
// proportionally within the original word's box). This catches codes that
// OCR concatenated with adjacent labels.
export async function ocrTile(png: Buffer, tileOffsetX: number, tileOffsetY: number): Promise<RawHit[]> {
  const resp = await callVisionWithRetry(png);
  const hits: RawHit[] = [];
  const pages = resp.fullTextAnnotation?.pages ?? [];
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const para of block.paragraphs ?? []) {
        for (const word of para.words ?? []) {
          const text = normalize((word.symbols ?? []).map((s: any) => s.text ?? "").join(""));
          if (!text) continue;
          const verts = word.boundingBox?.vertices ?? [];
          if (verts.length < 4) continue;
          const xs = verts.map((v: any) => v.x ?? 0);
          const ys = verts.map((v: any) => v.y ?? 0);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const w = Math.max(...xs) - x;
          const h = Math.max(...ys) - y;
          const conf = Number(word.confidence ?? 0);

          // Find every code-shaped substring within the token.
          const matches = [...text.matchAll(CODE_EXTRACT_RE)];
          if (matches.length === 0) {
            // Keep raw words so the LF7+X merge step can build LF7-X from
            // a bare "LF7" followed by an "X" in an adjacent token.
            hits.push({
              code: `raw:${text}`,
              conf, x: tileOffsetX + x, y: tileOffsetY + y, w, h,
            });
            continue;
          }
          if (matches.length === 1 && matches[0][0] === text) {
            // Clean whole-token match — fast path, keep the exact bbox.
            hits.push({ code: text, conf, x: tileOffsetX + x, y: tileOffsetY + y, w, h });
            continue;
          }
          // Multi-match or partial-match: interpolate bbox proportionally
          // across the token width. Approximate but good enough for clickable
          // boxes on the rendered page.
          const tokenLen = text.length;
          for (const m of matches) {
            const start = m.index ?? 0;
            const end = start + m[0].length;
            const subX = x + (start / tokenLen) * w;
            const subW = ((end - start) / tokenLen) * w;
            hits.push({
              code: m[0],
              conf,
              x: tileOffsetX + subX,
              y: tileOffsetY + y,
              w: subW,
              h,
            });
          }
        }
      }
    }
  }
  return hits;
}

export async function probeCredentials(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getClient();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// For local-dev: turn GOOGLE_APPLICATION_CREDENTIALS_JSON into a temp file on cold start.
// (Vercel functions need writable /tmp.)
export function ensureCredsFileFromEnv(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  const inline = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!inline) return;
  const tmp = path.join(os.tmpdir(), "gcp-sa.json");
  if (!fs.existsSync(tmp)) {
    fs.writeFileSync(tmp, inline, "utf8");
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}
