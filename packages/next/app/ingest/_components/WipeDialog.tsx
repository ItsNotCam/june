// author: Claude
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

type WipeDialogProps = {
  open: boolean;
  name: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * Confirmation modal for the irreversible wipe action. Self-contained (no
 * dialog library) so it stays dependency-proof; Escape + backdrop click cancel
 * unless a wipe is already in flight.
 */
export function WipeDialog({ open, name, busy = false, onCancel, onConfirm }: WipeDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
        onClick={() => !busy && onCancel()}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="bg-popover relative z-10 w-full max-w-md space-y-4 rounded-xl border p-6 shadow-lg"
      >
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold">Wipe this document?</h2>
          <p className="text-muted-foreground text-sm">
            This permanently deletes the embeddings and sidecar rows for{" "}
            <span className="text-foreground font-mono font-medium">{name}</span>, and removes the
            staged file from disk. This cannot be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Wiping…" : "Wipe"}
          </Button>
        </div>
      </div>
    </div>
  );
}
