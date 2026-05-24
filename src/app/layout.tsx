import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Electrical PDF OCR",
  description: "Upload an engineering drawing, get bounding boxes around every fixture code.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
