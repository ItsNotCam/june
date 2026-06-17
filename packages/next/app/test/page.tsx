// author: Claude
import { TestDashboard } from "./_components/TestDashboard";

export const metadata = {
  title: "june. — pipeline test",
  description: "Run the bench RAG-eval pipeline and watch live progress.",
};

export default function TestPage() {
  return (
    <main className="mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline test</h1>
        <p className="text-muted-foreground text-sm">
          Start a bench run and watch each stage progress live over SSE.
        </p>
      </header>
      <TestDashboard />
    </main>
  );
}
