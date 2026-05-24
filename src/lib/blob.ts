// Thin wrapper around @vercel/blob with a local-disk fallback for dev when
// BLOB_READ_WRITE_TOKEN isn't set. Local files land in ./.local-blob/.
import fs from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = path.resolve(process.cwd(), ".local-blob");

function isLocal(): boolean {
  return !process.env.BLOB_READ_WRITE_TOKEN;
}

async function ensureLocalDir(p: string) {
  await fs.mkdir(path.dirname(p), { recursive: true });
}

export interface PutResult {
  url: string;
  pathname: string;
}

export async function putBytes(pathname: string, data: Buffer | Uint8Array, contentType: string): Promise<PutResult> {
  if (isLocal()) {
    const full = path.join(LOCAL_DIR, pathname);
    await ensureLocalDir(full);
    await fs.writeFile(full, data);
    return { url: `/api/blob/${pathname}`, pathname };
  }
  const { put } = await import("@vercel/blob");
  const blob = await put(pathname, data as any, {
    access: "public",
    contentType,
    addRandomSuffix: false,
  } as any);
  return { url: blob.url, pathname };
}

export async function putJson(pathname: string, obj: unknown): Promise<PutResult> {
  return putBytes(pathname, Buffer.from(JSON.stringify(obj), "utf8"), "application/json");
}

export async function getJson<T>(pathname: string): Promise<T | null> {
  if (isLocal()) {
    const full = path.join(LOCAL_DIR, pathname);
    try {
      const buf = await fs.readFile(full, "utf8");
      return JSON.parse(buf) as T;
    } catch {
      return null;
    }
  }
  const { list } = await import("@vercel/blob");
  // result.json is overwritten each time → cache-buster via random suffix would
  // bloat the index. We just list newest-first and pick the matching pathname.
  const { blobs } = await list({ prefix: pathname, limit: 10 });
  const match = blobs.find((b) => b.pathname === pathname);
  if (!match) return null;
  const resp = await fetch(match.url, { cache: "no-store" });
  if (!resp.ok) return null;
  return (await resp.json()) as T;
}

export async function getBytes(pathnameOrUrl: string): Promise<Buffer | null> {
  // Absolute URL (Vercel Blob direct upload returns a full https:// URL)
  if (/^https?:\/\//i.test(pathnameOrUrl)) {
    const resp = await fetch(pathnameOrUrl, { cache: "no-store" });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  }
  if (isLocal()) {
    const full = path.join(LOCAL_DIR, pathnameOrUrl);
    try {
      return await fs.readFile(full);
    } catch {
      return null;
    }
  }
  const { list } = await import("@vercel/blob");
  const { blobs } = await list({ prefix: pathnameOrUrl, limit: 1 });
  const match = blobs.find((b) => b.pathname === pathnameOrUrl);
  if (!match) return null;
  const resp = await fetch(match.url, { cache: "no-store" });
  if (!resp.ok) return null;
  return Buffer.from(await resp.arrayBuffer());
}

export function urlFor(pathname: string): string {
  if (isLocal()) return `/api/blob/${pathname}`;
  // For Vercel Blob, we need to look up the URL when we wrote it.
  // The PageResult.imageUrl is set at write time, so this fallback isn't usually hit.
  return pathname;
}

export function localBlobRoot() {
  return LOCAL_DIR;
}
