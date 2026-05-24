// Local-dev only: serves files from .local-blob/ so the UI can fetch page images
// without needing Vercel Blob configured.
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { localBlobRoot } from "@/lib/blob";

export const runtime = "nodejs";

const CT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const safeParts = parts.map((p) => p.replace(/[^a-zA-Z0-9._-]/g, "_"));
  const full = path.join(localBlobRoot(), ...safeParts);
  try {
    const buf = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    return new NextResponse(buf, {
      headers: {
        "content-type": CT[ext] ?? "application/octet-stream",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
