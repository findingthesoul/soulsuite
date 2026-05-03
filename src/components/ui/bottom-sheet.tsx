"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Mobile bottom-sheet panel. Slides up from the bottom edge, dims the rest of the
// viewport, closes on backdrop tap or ESC. Built standalone (not Dialog) because
// Dialog centres its panel and we'd be fighting positioning + animation. Sticking
// the safe-area inset on the panel keeps the iOS home-indicator from sitting on
// top of the action row.

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function BottomSheet({ open, onOpenChange, children, className, ariaLabel }: BottomSheetProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-end justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        aria-hidden="true"
        onMouseDown={() => onOpenChange(false)}
      />
      <div
        className={cn(
          "relative z-10 w-full max-w-2xl rounded-t-2xl border-t border-border bg-surface shadow-xl",
          "pb-[env(safe-area-inset-bottom)]",
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Drag handle (visual only — no gesture lib per spec). */}
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="h-1 w-10 rounded-full bg-border" aria-hidden="true" />
        </div>
        {children}
      </div>
    </div>
  );
}
