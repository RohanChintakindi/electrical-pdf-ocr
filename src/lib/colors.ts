// Deterministic code → HSL color. Same code always gets same hue.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForCode(code: string): string {
  const hue = hash(code) % 360;
  return `hsl(${hue} 85% 45%)`;
}

export function colorForCodeWithAlpha(code: string, alpha: number): string {
  const hue = hash(code) % 360;
  return `hsla(${hue} 85% 45% / ${alpha})`;
}
