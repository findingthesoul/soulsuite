"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Hand-rolled tabs primitive (no Radix). Used across forms that chunk a long
// settings page into navigable sections sharing a single SaveBar.

interface TabsContextValue {
  value: string;
  onValueChange: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used inside <Tabs>");
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const ctx = React.useMemo(() => ({ value, onValueChange }), [value, onValueChange]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={cn("space-y-6", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TabsList({ className, children, ...props }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex flex-wrap items-center gap-1 border-b border-border",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
  errorCount?: number;
}

export function TabsTrigger({
  value,
  errorCount = 0,
  className,
  children,
  ...props
}: TabsTriggerProps) {
  const ctx = useTabsContext();
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.onValueChange(value)}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors border-b-2",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {errorCount > 0 && (
        <span
          aria-label={`${errorCount} error${errorCount === 1 ? "" : "s"} on this tab`}
          className="inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
        >
          <span aria-hidden>⚠</span>
          {errorCount}
        </span>
      )}
    </button>
  );
}

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const ctx = useTabsContext();
  if (ctx.value !== value) return null;
  return (
    <div role="tabpanel" className={cn("space-y-6", className)} {...props}>
      {children}
    </div>
  );
}
