import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">june.</h1>
        <p className="text-muted-foreground text-lg">Your unified developer knowledge platform.</p>
        <Button>Get started</Button>
      </div>
    </div>
  );
}
