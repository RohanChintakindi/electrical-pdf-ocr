// End-to-end smoke test: upload Jesse's PDF to prod via the same direct-to-Blob
// flow the browser uses, then poll until processing completes.
import fs from "node:fs";
import { upload } from "@vercel/blob/client";
import { v4 as uuid } from "uuid";

const PROD = "https://electrical-pdf-ocr.vercel.app";
const PDF = "C:/Users/Chint/Downloads/ELECTRICAL (2) (1).pdf";

const file = new File([fs.readFileSync(PDF)], "ELECTRICAL (2) (1).pdf", { type: "application/pdf" });
const jobId = uuid();
console.log("[upload] jobId:", jobId);
console.log("[upload] size:", (file.size / 1024 / 1024).toFixed(2), "MB");

const blob = await upload(`jobs/${jobId}/source.pdf`, file, {
  access: "public",
  handleUploadUrl: `${PROD}/api/upload`,
  contentType: "application/pdf",
  clientPayload: JSON.stringify({ jobId, pdfName: file.name }),
});
console.log("[upload] complete, kicking off /api/process");

// The real browser does this in UploadDropzone.tsx — fire-and-forget from
// inside onUploadCompleted doesn't survive serverless function exit.
fetch(`${PROD}/api/process`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jobId, pdfName: file.name, pdfPath: blob.url }),
}).then((r) => console.log("[process] kickoff status:", r.status))
  .catch((e) => console.log("[process] kickoff err:", e.message));

console.log("[poll] starting");

let prev = "";
while (true) {
  const r = await fetch(`${PROD}/api/result/${jobId}`, { cache: "no-store" });
  if (r.ok) {
    const j = await r.json();
    const done = j.pages.filter((p) => p.status === "done").length;
    const proc = j.pages.filter((p) => p.status === "processing").length;
    const cur = `${j.status} pages ${done}/${j.pages.length} proc ${proc} hits ${j.meta.totalHits} codes ${j.codes.length}`;
    if (cur !== prev) {
      console.log("[poll]", new Date().toISOString().slice(11, 19), cur, j.error ? `err: ${j.error}` : "");
      prev = cur;
    }
    if (["complete", "partial", "error"].includes(j.status)) {
      console.log("[done] view:", `${PROD}/results/${jobId}`);
      if (j.status === "complete" || j.status === "partial") {
        console.log("[codes]:");
        for (const c of j.codes) console.log(" ", c.code, "x", c.count);
      }
      break;
    }
  } else {
    console.log("[poll]", r.status, "waiting…");
  }
  await new Promise((r) => setTimeout(r, 4000));
}
