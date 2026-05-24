import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sharp", "pdfjs-dist", "@google-cloud/vision", "@napi-rs/canvas"],
  turbopack: { root: __dirname },
  experimental: {
    serverActions: { bodySizeLimit: "60mb" },
  },
  // pdfjs loads its worker module dynamically at runtime, so Next's static
  // tracer doesn't see it as a dependency. Force-include it for /api/process.
  outputFileTracingIncludes: {
    "/api/process": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas/**",
      "./node_modules/@napi-rs/canvas-linux-x64-gnu/**",
    ],
  },
  // Vercel serverless functions have a 250 MB unzipped limit. The heavy deps
  // (pdfjs-dist, @napi-rs/canvas, sharp, @google-cloud/vision) ship lots of
  // material we never use at runtime. Exclude it from every function bundle —
  // and re-include just the pdfjs-dist node bits the /api/process function
  // actually needs.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@napi-rs/canvas-win32-*",
      "node_modules/@napi-rs/canvas-darwin-*",
      "node_modules/@napi-rs/canvas-android-*",
      "node_modules/@napi-rs/canvas-freebsd-*",
      "node_modules/@napi-rs/canvas-linux-*-musl/**",
      "node_modules/@napi-rs/canvas-linux-arm*/**",
      "node_modules/pdfjs-dist/web/**",
      "node_modules/pdfjs-dist/build/**",
      "node_modules/pdfjs-dist/image_decoders/**",
      "node_modules/pdfjs-dist/types/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-win32-*/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-darwin-*/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-android-*/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-freebsd-*/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-linux-*-musl/**",
      "node_modules/pdfjs-dist/node_modules/@napi-rs/canvas-linux-arm*/**",
      "node_modules/sharp/build/Release/sharp-darwin*",
      "node_modules/sharp/build/Release/sharp-win32*",
      "node_modules/sharp/build/Release/sharp-linuxmusl*",
      "node_modules/sharp/build/Release/sharp-linux-arm*",
      "node_modules/@img/sharp-darwin-*/**",
      "node_modules/@img/sharp-win32-*/**",
      "node_modules/@img/sharp-linuxmusl-*/**",
      "node_modules/@img/sharp-linux-arm*/**",
      "node_modules/@img/sharp-libvips-darwin-*/**",
      "node_modules/@img/sharp-libvips-win32-*/**",
      "node_modules/@img/sharp-libvips-linuxmusl-*/**",
      "node_modules/@img/sharp-libvips-linux-arm*/**",
      "node_modules/@google-cloud/vision/build/protos/**",
      "**/*.md",
      "**/*.d.ts",
      "**/*.map",
      "**/LICENSE*",
      "**/CHANGELOG*",
      "**/test/**",
      "**/tests/**",
      "**/example/**",
      "**/examples/**",
      "**/.github/**",
    ],
  },
};

export default nextConfig;
