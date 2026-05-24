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

// Dedupe overlapping detections of the SAME code (e.g., across tile
// boundaries OR a substring-extracted hit landing near a clean detection).
// Drops a hit when it overlaps an existing kept hit by IoU > threshold OR
// its center is within ~1 font-height of another kept hit of the same code.
// The centroid check catches the substring-extract case where the
// proportionally-interpolated bbox is offset from the clean bbox enough to
// dodge the IoU threshold.
export function dedupeOverlaps(hits: RawHit[], threshold = 0.4): RawHit[] {
  const sorted = [...hits].sort((a, b) => b.conf - a.conf);
  const kept: RawHit[] = [];
  for (const h of sorted) {
    let drop = false;
    for (const k of kept) {
      if (k.code !== h.code) continue;
      if (iou(h, k) > threshold) { drop = true; break; }
      // Centroid distance: if two hits of the same code have centers within
      // ~1 font height of each other, treat as a duplicate. Use h's height
      // as the scale since proportional interpolation tends to preserve it.
      const cx1 = h.x + h.w / 2, cy1 = h.y + h.h / 2;
      const cx2 = k.x + k.w / 2, cy2 = k.y + k.h / 2;
      const dist = Math.hypot(cx1 - cx2, cy1 - cy2);
      const scale = Math.min(h.h, k.h) || 1;
      if (dist < scale * 1.5) { drop = true; break; }
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

  // Returns the code itself if it matches the legend exactly, or matches a
  // wildcard prefix. Wildcard matches keep their specific suffix (LF7-4
  // stays LF7-4) so the count rollup preserves variant breakdowns.
  const wildcardCanonical = (code: string): string | null => {
    if (exact.has(code)) return code;
    for (const p of wildcardPrefixes) if (code.startsWith(p)) return code;
    return null;
  };

  // Concrete candidates we can compare against — every exact legend code,
  // plus a few illustrative wildcard variants (LF7-X expands so suffix matches
  // can resolve "7-8" -> "LF7-8" via the LF7- wildcard).
  const legendCandidates = new Set<string>(exact);
  const SUFFIX_VARIANTS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (const p of wildcardPrefixes) for (const s of SUFFIX_VARIANTS) legendCandidates.add(p + s);

  // Generic recovery: try to find a legend code that, when we drop up to
  // PREFIX_BUDGET leading characters from it, gives our detected code. This
  // captures all the symbol/circle-prefix misread patterns in one rule:
  //   OLF4   -> drop 0 from token, drop 0 from legend "LF4" → token "OLF4"
  //             vs "LF4": suffix match with 1 char missing → ok
  //   PLF4   -> same (token has 1 leading junk char vs legend)
  //   F4     -> legend "LF4" has 1 leading char we don't have → match
  //   7-8    -> legend "LF7-8" has 2 leading chars we don't have → match
  //   EMLF5  -> token has 2 leading junk chars vs legend "LF5" → match
  // PREFIX_BUDGET = 2 covers everything we've seen. No symbol-specific list.
  const PREFIX_BUDGET = 2;
  const recoverBySuffix = (code: string): string | null => {
    // Case A: token is "junk" + legend_code. Strip up to PREFIX_BUDGET leading chars.
    for (let k = 1; k <= Math.min(PREFIX_BUDGET, code.length - 2); k++) {
      const tail = code.slice(k);
      const c = wildcardCanonical(tail);
      if (c) return c;
    }
    // Case B: legend_code is "missing_prefix" + token. Find a legend code
    // that ends with this token and has 1-2 leading chars more.
    for (const candidate of legendCandidates) {
      const diff = candidate.length - code.length;
      if (diff < 1 || diff > PREFIX_BUDGET) continue;
      if (candidate.endsWith(code)) {
        const c = wildcardCanonical(candidate);
        if (c) return c;
      }
    }
    return null;
  };

  const resolve = (code: string): string | null => {
    const direct = wildcardCanonical(code);
    if (direct) return direct;
    return recoverBySuffix(code);
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
