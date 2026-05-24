import type { RawHit, Instance } from "./types";

function iou(a: RawHit, b: RawHit): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Merge LF7 + X into LF7-X.
// Look for a code-shaped token followed within 50px to the right by a 1-2 char
// alphanumeric (the suffix part).
// Returns updated hits with raw: stripped where we kept them.
export function mergeAdjacentSuffixes(hits: RawHit[]): RawHit[] {
  const codeHits = hits.filter((h) => !h.code.startsWith("raw:"));
  const rawHits = hits.filter((h) => h.code.startsWith("raw:"));
  const SUFFIX_RE = /^[A-Z0-9]{1,3}$/;
  const merged: RawHit[] = [];
  const consumed = new Set<RawHit>();
  for (const c of codeHits) {
    if (c.code.includes("-")) {
      merged.push(c);
      continue;
    }
    const cyMid = c.y + c.h / 2;
    const cRight = c.x + c.w;
    let bestSuffix: RawHit | null = null;
    let bestDx = Infinity;
    for (const r of rawHits) {
      if (consumed.has(r)) continue;
      const text = r.code.slice(4); // strip "raw:"
      if (!SUFFIX_RE.test(text)) continue;
      const ryMid = r.y + r.h / 2;
      const dy = Math.abs(ryMid - cyMid);
      if (dy > Math.max(c.h, r.h) * 0.6) continue;
      const dx = r.x - cRight;
      if (dx < -5 || dx > 50) continue;
      if (dx < bestDx) {
        bestDx = dx;
        bestSuffix = r;
      }
    }
    if (bestSuffix) {
      const text = bestSuffix.code.slice(4);
      consumed.add(bestSuffix);
      merged.push({
        code: `${c.code}-${text}`,
        conf: Math.min(c.conf, bestSuffix.conf),
        x: c.x,
        y: Math.min(c.y, bestSuffix.y),
        w: bestSuffix.x + bestSuffix.w - c.x,
        h: Math.max(c.y + c.h, bestSuffix.y + bestSuffix.h) - Math.min(c.y, bestSuffix.y),
      });
    } else {
      merged.push(c);
    }
  }
  return merged;
}

// Dedupe overlapping detections of the SAME code (e.g., across tile boundaries).
// Keeps the highest-confidence one; drops any other instance that has IoU > threshold and same code.
export function dedupeOverlaps(hits: RawHit[], threshold = 0.4): RawHit[] {
  const sorted = [...hits].sort((a, b) => b.conf - a.conf);
  const kept: RawHit[] = [];
  for (const h of sorted) {
    let drop = false;
    for (const k of kept) {
      if (k.code !== h.code) continue;
      if (iou(h, k) > threshold) {
        drop = true;
        break;
      }
    }
    if (!drop) kept.push(h);
  }
  return kept;
}

// Final filter: only keep codes that match the legend (if provided) plus the regex shape.
//
// Conventions:
// - A legend entry like `LF7-X` means "LF7 with any -suffix" (X = wildcard).
//   On Jesse's drawing the LF7-X row reads "-4 = 4', -6 = 6', -8 = 8'",
//   so LF7-4 / LF7-6 / LF7-8 count against LF7-X.
// - Fuzzy recovery: OCR often reads a circle symbol "○" right next to a code
//   as the letter "O", so a fixture marked "(○)LF4" comes through as "OLF4".
//   If a code doesn't match the legend exactly, try stripping one leading
//   ambiguous letter and re-match. This rescues OLF4 → LF4, OLF10 → LF10, etc.
export function filterByLegend(hits: RawHit[], legendCodes: string[]): Instance[] {
  const exact = new Set<string>();
  const wildcardPrefixes: string[] = [];
  for (const c of legendCodes) {
    const up = c.toUpperCase();
    if (up.endsWith("-X")) wildcardPrefixes.push(up.slice(0, -1));
    exact.add(up);
  }
  const useLegend = exact.size > 0;

  const exactOrWildcard = (code: string): boolean => {
    if (exact.has(code)) return true;
    for (const p of wildcardPrefixes) if (code.startsWith(p)) return true;
    return false;
  };
  const wildcardCanonical = (code: string): string | null => {
    if (exact.has(code)) return code;
    for (const p of wildcardPrefixes) if (code.startsWith(p)) return p + "X";
    return null;
  };
  // Returns the canonical legend code if `code` matches, else null.
  // Tries (in order): exact/wildcard, strip-1-leading-char (handles a circle
  // symbol next to a code that OCR mistook for a letter — observed: O, P,
  // C, Q, 0), strip-2-leading-chars (handles "EM○LF5" → "LF5"), and finally
  // prepend-L (handles "○LF4" where the circle ate the L → "F4").
  const STRIPPABLE_LEADERS = new Set(["O", "0", "Q", "C", "P", "D", "G"]);
  const resolve = (code: string): string | null => {
    const direct = wildcardCanonical(code);
    if (direct) return direct;
    // Strip one leading misread letter
    if (code.length > 2 && STRIPPABLE_LEADERS.has(code[0])) {
      const c = wildcardCanonical(code.slice(1));
      if (c) return c;
    }
    // Strip two leading misread letters (e.g. "EM" annotation + circle joined to code)
    if (code.length > 3 && STRIPPABLE_LEADERS.has(code[1])) {
      const c = wildcardCanonical(code.slice(2));
      if (c) return c;
    }
    // Prepend L for things like F4 that were short by an L (circle absorbed it).
    // Constrain to codes shaped like a fixture (1 cap + digits) to avoid
    // converting noise like "B5" into "LB5".
    if (/^F\d+(?:-\w+)?$/.test(code)) {
      const c = wildcardCanonical("L" + code);
      if (c) return c;
    }
    return null;
  };

  const out: Instance[] = [];
  for (const h of hits) {
    if (h.code.startsWith("raw:")) continue;
    if (!useLegend) {
      out.push({ code: h.code, x: h.x, y: h.y, w: h.w, h: h.h, conf: h.conf });
      continue;
    }
    const canonical = resolve(h.code.toUpperCase());
    if (!canonical) continue;
    out.push({ code: canonical, x: h.x, y: h.y, w: h.w, h: h.h, conf: h.conf });
  }
  return out;
}
