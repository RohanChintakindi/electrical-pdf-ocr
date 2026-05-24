// Wipe all jobs/* blobs — useful when the 1GB Hobby quota fills up.
import { list, del } from "@vercel/blob";
import fs from "node:fs";

const envFile = ".env.production";
if (!fs.existsSync(envFile)) {
  console.error(`Run \`vercel env pull ${envFile} --environment=production --yes\` first`);
  process.exit(1);
}
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=("?)(.*)\2\s*$/);
  if (m) process.env[m[1]] = m[3];
}

let cursor;
let total = 0;
let bytes = 0;
do {
  const { blobs, cursor: next, hasMore } = await list({ cursor, limit: 1000 });
  if (!blobs.length) break;
  const urls = blobs.map((b) => b.url);
  bytes += blobs.reduce((s, b) => s + b.size, 0);
  total += blobs.length;
  await del(urls);
  console.log(`deleted ${blobs.length} blobs (${(bytes/1024/1024).toFixed(1)} MB total so far)`);
  cursor = hasMore ? next : undefined;
} while (cursor);
console.log(`done. ${total} blobs deleted, ${(bytes/1024/1024).toFixed(1)} MB freed`);
