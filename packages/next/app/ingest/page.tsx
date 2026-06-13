// author: Claude
import { IngestClient } from "./_components/IngestClient";

export const metadata = {
  title: "Ingest — june",
  description: "Upload markdown and run the june ingestion pipeline.",
};

export default function IngestPage() {
  return (
    <div className="bg-muted/40 min-h-screen">
      <div className="mx-auto max-w-5xl space-y-8 p-8">
        <header className="space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">Ingest markdown</h1>
          <p className="text-muted-foreground text-sm">
            Upload one or more markdown files and run the full pipeline — parse, chunk, summarize,
            embed, and store. Click a row to watch its live log; wipe to remove a document entirely.
          </p>
        </header>
        <IngestClient />
      </div>
    </div>
  );
}
