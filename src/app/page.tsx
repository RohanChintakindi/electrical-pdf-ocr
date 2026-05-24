import UploadDropzone from "@/components/UploadDropzone";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-10">
        <header className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Electrical PDF OCR</h1>
          <p className="text-muted-foreground">
            Upload an engineering drawing. Get bounding boxes around every fixture code.
          </p>
        </header>
        <div className="flex justify-center">
          <UploadDropzone />
        </div>
      </div>
    </main>
  );
}
