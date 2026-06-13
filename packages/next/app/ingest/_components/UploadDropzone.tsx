// author: Claude
"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/utils";

type UploadDropzoneProps = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
};

const MARKDOWN_RE = /\.(md|markdown)$/i;

/** Drag-and-drop + file-picker for markdown uploads. Filters to .md/.markdown. */
export function UploadDropzone({ onFiles, disabled = false }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (list: FileList | null): void => {
    if (!list) return;
    const files = Array.from(list).filter((f) => MARKDOWN_RE.test(f.name));
    if (files.length > 0) onFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) accept(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 p-10 text-center transition-colors",
        dragging && "border-primary bg-primary/5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="text-muted-foreground text-2xl">⬡</span>
      <p className="text-sm font-medium">Drop markdown files here</p>
      <p className="text-muted-foreground text-xs">.md or .markdown — multiple allowed</p>
      <input
        ref={inputRef}
        type="file"
        accept=".md,.markdown"
        multiple
        hidden
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Browse files
      </Button>
    </div>
  );
}
