import type { RawHit, Instance } from "./types";

// True iff `a` can be turned into `b` (or vice versa) by inserting or deleting
// exactly one character. Assumes |len(a) - len(b)| === 1; caller guards.
function isOneCharEdit(a: string, b: string): boolean {
  let shorter = a, longer = b;
  if (shorter.length > longer.length) [shorter, longer] = [longer, shorter];
  if (longer.length - shorter.length !== 1) return false;
  let i = 0, j = 0, skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++; // consume the extra char in `longer`
  }
  return true; // trailing extra char in longer is fine
}

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
      // Centroid distance: only drop when centers are nearly coincident
      // (within half a font height). Anything larger risks collapsing two
      // legitimate adjacent fixtures with the same code (clusters happen).
      const cx1 = h.x + h.w / 2, cy1 = h.y + h.h / 2;
      const cx2 = k.x + k.w / 2, cy2 = k.y + k.h / 2;
      const dist = Math.hypot(cx1 - cx2, cy1 - cy2);
      const scale = Math.min(h.h, k.h) || 1;
      if (dist < scale * 0.5) { drop = true; break; }
    }
    if (!drop) kept.push(h);
  }
  return kept;
}

// Build a resolver function from a legend code list. Resolver returns the
// canonical code (preserving wildcard suffixes), or null if no match.
// Centralized so both filterByLegend and the verify pass use identical logic.
//
// Conventions:
// - A legend entry like `LF7-X` means "LF7 with any -suffix" (X = wildcard).
//   On Jesse's drawing the LF7-X row reads "-4 = 4', -6 = 6', -8 = 8'",
//   so LF7-4 / LF7-6 / LF7-8 count against LF7-X.
// - Fuzzy recovery has 3 layers: exact/wildcard → leading-prefix budget →
//   1-char edit anywhere. Edit-distance recovery abstains on ambiguity.
export function buildLegendResolver(legendCodes: string[]): {
  resolve: (code: string) => string | null;
  hasLegend: boolean;
} {
  const exact = new Set<string>();
  const wildcardPrefixes: string[] = [];
  for (const c of legendCodes) {
    const up = c.toUpperCase();
    if (up.endsWith("-X")) wildcardPrefixes.push(up.slice(0, -1));
    exact.add(up);
  }
  const hasLegend = exact.size > 0;

  const wildcardCanonical = (code: string): string | null => {
    if (exact.has(code)) return code;
    for (const p of wildcardPrefixes) if (code.startsWith(p)) return code;
    return null;
  };

  const legendCandidates = new Set<string>(exact);
  const SUFFIX_VARIANTS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
  for (const p of wildcardPrefixes) for (const s of SUFFIX_VARIANTS) legendCandidates.add(p + s);

  const PREFIX_BUDGET = 2;
  const recoverBySuffix = (code: string): string | null => {
    for (let k = 1; k <= Math.min(PREFIX_BUDGET, code.length - 2); k++) {
      const tail = code.slice(k);
      const c = wildcardCanonical(tail);
      if (c) return c;
    }
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

  const recoverByEdit = (code: string): string | null => {
    if (code.length < 3) return null;
    let match: string | null = null;
    for (const candidate of legendCandidates) {
      if (Math.abs(candidate.length - code.length) !== 1) continue;
      if (!isOneCharEdit(code, candidate)) continue;
      const resolved = wildcardCanonical(candidate);
      if (!resolved) continue;
      if (match && match !== resolved) return null;
      match = resolved;
    }
    return match;
  };

  const resolve = (code: string): string | null => {
    const direct = wildcardCanonical(code);
    if (direct) return direct;
    const suffix = recoverBySuffix(code);
    if (suffix) return suffix;
    return recoverByEdit(code);
  };

  return { resolve, hasLegend };
}

// Final filter: only keep codes that match the legend (if provided).
// Thin wrapper around buildLegendResolver for backwards compat with callers
// that just want to filter a hit list.
export function filterByLegend(hits: RawHit[], legendCodes: string[]): Instance[] {
  const { resolve, hasLegend } = buildLegendResolver(legendCodes);
  const out: Instance[] = [];
  for (const h of hits) {
    if (h.code.startsWith("raw:")) continue;
    if (!hasLegend) {
      out.push({ code: h.code, x: h.x, y: h.y, w: h.w, h: h.h, conf: h.conf });
      continue;
    }
    const canonical = resolve(h.code.toUpperCase());
    if (!canonical) continue;
    out.push({ code: canonical, x: h.x, y: h.y, w: h.w, h: h.h, conf: h.conf });
  }
  return out;
}
