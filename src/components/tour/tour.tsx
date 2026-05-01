"use client";

import * as React from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "soul-suite-tour-seen";
const OPEN_EVENT = "soul-suite:open-tour";

export function openTour() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

interface Step {
  selector: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    selector: "",
    title: "Welcome to Soul Suite",
    body:
      "Your scheduling hub, built on Google Calendar. Three layers work together: your Workspace (the org), Teams (project-scoped meetings), and your Personal scheduling.",
  },
  {
    selector: '[data-tour="sidebar-home"]',
    title: "Home",
    body: "Your overview — today's bookings, what's next, and quick actions.",
  },
  {
    selector: '[data-tour="sidebar-bookings"]',
    title: "Bookings",
    body: "Every booking, past and upcoming, in one place.",
  },
  {
    selector: '[data-tour="sidebar-teams"]',
    title: "Teams",
    body: "Project-scoped meeting types. Round-robin and collective events live here, shared with collaborators.",
  },
  {
    selector: '[data-tour="sidebar-scheduling"]',
    title: "Scheduling",
    body: "Your personal meeting types. One-on-ones, group calls, polls, and one-off events.",
  },
  {
    selector: '[data-tour="new-button"]',
    title: "Create something new",
    body: "Spin up any event type from here — hover each option to see what fits.",
  },
  {
    selector: '[data-tour="user-menu"]',
    title: "Your menu",
    body: "Profile, settings, theme, sidebar mode. You can re-launch this tour any time from \"Take a tour\".",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function Tour({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const nextRef = React.useRef<HTMLButtonElement>(null);

  // Auto-open on first visit if never seen.
  React.useEffect(() => {
    if (!autoOpen) return;
    if (typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== "1") {
        // Slight delay so the page chrome is mounted.
        const t = window.setTimeout(() => setOpen(true), 400);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, [autoOpen]);

  // External open trigger.
  React.useEffect(() => {
    function handler() {
      setStepIndex(0);
      setOpen(true);
    }
    window.addEventListener(OPEN_EVENT, handler as EventListener);
    return () => window.removeEventListener(OPEN_EVENT, handler as EventListener);
  }, []);

  // Resolve target rect for current step.
  React.useEffect(() => {
    if (!open) return;
    const step = STEPS[stepIndex];
    if (!step.selector) {
      setRect(null);
      return;
    }

    function measure() {
      const el = document.querySelector(step.selector) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      // Wait a frame for scroll to settle.
      requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    }
    measure();
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const interval = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.clearInterval(interval);
    };
  }, [open, stepIndex]);

  // ESC closes; focus Next on each step.
  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    }
    window.addEventListener("keydown", onKey);
    nextRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stepIndex]);

  function finish() {
    setOpen(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function next() {
    if (stepIndex >= STEPS.length - 1) {
      finish();
      return;
    }
    setStepIndex((i) => i + 1);
  }

  function back() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  if (!open) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  // SVG mask: full overlay with rect cutout.
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const padding = 6;
  const ring = rect
    ? {
        top: rect.top - padding,
        left: rect.left - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      }
    : null;

  // Tooltip position: near target if any, else centered.
  const tooltipStyle = computeTooltipPosition(ring, vw, vh);

  return (
    <div className="fixed inset-0 z-[100]" aria-modal="true" role="dialog" aria-labelledby="tour-title">
      {/* Dim overlay with cutout via SVG mask. */}
      <svg
        className="absolute inset-0 h-full w-full pointer-events-auto"
        onClick={(e) => {
          // Click outside ring closes the tour. Click inside passes through.
          if (!ring) {
            // Welcome step: don't close on overlay click — give Skip a clear target.
            return;
          }
          const x = e.clientX;
          const y = e.clientY;
          if (
            x >= ring.left &&
            x <= ring.left + ring.width &&
            y >= ring.top &&
            y <= ring.top + ring.height
          ) {
            return;
          }
        }}
      >
        <defs>
          <mask id="tour-mask">
            <rect x={0} y={0} width="100%" height="100%" fill="white" />
            {ring && (
              <rect
                x={ring.left}
                y={ring.top}
                width={ring.width}
                height={ring.height}
                rx={8}
                ry={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#tour-mask)" />
        {ring && (
          <rect
            x={ring.left}
            y={ring.top}
            width={ring.width}
            height={ring.height}
            rx={8}
            ry={8}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={2}
          />
        )}
      </svg>

      {/* Tooltip card */}
      <div className="absolute pointer-events-auto" style={tooltipStyle}>
        <Card className="w-80 shadow-lg">
          <CardHeader className="pb-2">
            <p className="text-xs text-muted-foreground">
              {stepIndex + 1} of {STEPS.length}
            </p>
            <CardTitle id="tour-title">{step.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{step.body}</p>
          </CardContent>
          <CardFooter className="justify-between">
            <Button variant="ghost" size="sm" onClick={finish}>
              Skip
            </Button>
            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button variant="secondary" size="sm" onClick={back}>
                  Back
                </Button>
              )}
              <Button ref={nextRef} variant="primary" size="sm" onClick={next}>
                {isLast ? "Done" : "Next"}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

function computeTooltipPosition(
  ring: Rect | null,
  vw: number,
  vh: number,
): React.CSSProperties {
  const tooltipW = 320;
  const tooltipH = 200;
  const gap = 16;

  if (!ring) {
    // Center.
    return {
      top: Math.max(16, vh / 2 - tooltipH / 2),
      left: Math.max(16, vw / 2 - tooltipW / 2),
    };
  }

  // Prefer below; if no room, place above; otherwise to the right.
  const spaceBelow = vh - (ring.top + ring.height);
  const spaceAbove = ring.top;

  let top: number;
  let left: number;

  if (spaceBelow >= tooltipH + gap) {
    top = ring.top + ring.height + gap;
    left = Math.min(Math.max(16, ring.left), vw - tooltipW - 16);
  } else if (spaceAbove >= tooltipH + gap) {
    top = ring.top - tooltipH - gap;
    left = Math.min(Math.max(16, ring.left), vw - tooltipW - 16);
  } else {
    // Side fallback: place to the right of the target if possible, else left.
    const spaceRight = vw - (ring.left + ring.width);
    if (spaceRight >= tooltipW + gap) {
      top = Math.min(Math.max(16, ring.top), vh - tooltipH - 16);
      left = ring.left + ring.width + gap;
    } else {
      top = Math.min(Math.max(16, ring.top), vh - tooltipH - 16);
      left = Math.max(16, ring.left - tooltipW - gap);
    }
  }

  return { top, left, width: tooltipW };
}
