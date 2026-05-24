// Admin: wipe every blob in storage. Mirrors scripts/cleanup-blobs.mjs.
// We run on Vercel Hobby (1GB blob quota). A handful of multi-page jobs fills
// it because each page renders a ~10-20MB PNG. Clearing here unblocks new
// uploads without dropping to the CLI.
import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { ok: false, error: "blob storage not configured (no BLOB_READ_WRITE_TOKEN)" },
      { status: 400 },
    );
  }
  let cursor: string | undefined;
  let total = 0;
  let bytes = 0;
  try {
    do {
      const { blobs, cursor: next, hasMore } = await list({ cursor, limit: 1000 });
      if (!blobs.length) break;
      bytes += blobs.reduce((s, b) => s + b.size, 0);
      total += blobs.length;
      await del(blobs.map((b) => b.url));
      cursor = hasMore ? next : undefined;
    } while (cursor);
    return NextResponse.json({ ok: true, deleted: total, freedMB: +(bytes / 1024 / 1024).toFixed(1) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, deleted: total, freedMB: +(bytes / 1024 / 1024).toFixed(1), error: e?.message ?? String(e) },
      { status: 500 },
    );
  }
}
