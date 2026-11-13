"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

// The guided tour (#21 phase 2), built in-house rather than with a library,
// so its accessibility is ours to guarantee: a real modal dialog per step
// (named by the step's title, described by its words), focus moved into it
// and kept there (Tab wraps), Escape closes, focus goes back to what had it
// (or the main landmark), and smooth scrolling only without
// prefers-reduced-motion. A step whose target isn't on the page is skipped.

export interface GuidedTourStep {
  // Matches `data-tour="<target>"` on the page.
  target: string;
  title: string;
  body: string;
}

export interface GuidedTourLabels {
  offer: string;
  start: string;
  decline: string;
  next: string;
  back: string;
  done: string;
  close: string;
  // "Step {step} of {total}"
  stepOf: string;
}

const targetOf = (step: GuidedTourStep) => document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function GuidedTour({
  steps,
  labels,
  offer,
  startOpen = false,
  onDone,
}: {
  steps: GuidedTourStep[];
  labels: GuidedTourLabels;
  // Show the "Take the tour" offer (first visit, or new steps since).
  offer: boolean;
  // Open straight away (the checklist's /?tour=1).
  startOpen?: boolean;
  // Finished, closed or declined: recorded so it isn't offered again.
  onDone: () => Promise<void>;
}) {
  const [offered, setOffered] = useState(offer);
  const [live, setLive] = useState<GuidedTourStep[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const finish = useCallback(() => {
    setIndex(null);
    setOffered(false);
    void onDone();
    const back = returnTo.current;
    if (back && back !== document.body && document.contains(back)) back.focus();
    else document.getElementById("main-content")?.focus();
  }, [onDone]);

  const start = useCallback(() => {
    const present = steps.filter((step) => targetOf(step));
    if (present.length === 0) return finish();
    returnTo.current = document.activeElement as HTMLElement | null;
    setOffered(false);
    setLive(present);
    setIndex(0);
  }, [steps, finish]);

  // Opened by the checklist's link: once, on arrival.
  const opened = useRef(false);
  useEffect(() => {
    if (startOpen && !opened.current) {
      opened.current = true;
      start();
    }
  }, [startOpen, start]);

  return (
    <>
      {offered ? (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <p className="flex-[1_1_16rem] text-[15px]">{labels.offer}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={start}>
              {labels.start}
            </button>
            <button type="button" className="btn btn-quiet" onClick={finish}>
              {labels.decline}
            </button>
          </div>
        </div>
      ) : null}
      {index !== null && live[index] ? (
        <StepDialog
          key={index}
          step={live[index]}
          position={index}
          total={live.length}
          labels={labels}
          onBack={() => setIndex(Math.max(0, index - 1))}
          onNext={() => (index + 1 < live.length ? setIndex(index + 1) : finish())}
          onClose={finish}
        />
      ) : null}
    </>
  );
}

function StepDialog({
  step,
  position,
  total,
  labels,
  onBack,
  onNext,
  onClose,
}: {
  step: GuidedTourStep;
  position: number;
  total: number;
  labels: GuidedTourLabels;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const last = position + 1 === total;

  // Bring the step's target into view, light it up, and move focus in.
  useLayoutEffect(() => {
    const target = targetOf(step);
    target?.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    const measure = () => setRect(target?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    primary.current?.focus();
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button")];
    const first = focusable[0];
    const lastButton = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastButton?.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      first?.focus();
    }
  };

  // Below the target when there's room, else above; kept on screen.
  const margin = 12;
  const width = 340;
  const top = rect
    ? rect.bottom + margin + 180 < window.innerHeight
      ? rect.bottom + margin
      : Math.max(margin, rect.top - margin - 180)
    : window.innerHeight / 3;
  const left = rect ? Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16)) : 16;

  return (
    <>
      {/* Dims the page around the target, and keeps clicks off it while
          the dialog is open (aria-modal says the same to assistive tech). */}
      <div aria-hidden="true" className="fixed inset-0 z-40" />
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] motion-safe:transition-all"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : null}
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
        className="card fixed z-50 flex flex-col gap-3 p-5 shadow-xl"
        style={{ top, left, width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <p className="text-sm font-semibold text-ink-muted">
          {labels.stepOf.replace("{step}", String(position + 1)).replace("{total}", String(total))}
        </p>
        <h2 id={`${id}-title`} className="text-lg font-bold">
          {step.title}
        </h2>
        <p id={`${id}-body`} className="text-[15px]">
          {step.body}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {labels.close}
          </button>
          <div className="flex gap-2">
            {position > 0 ? (
              <button type="button" className="btn btn-secondary" onClick={onBack}>
                {labels.back}
              </button>
            ) : null}
            <button ref={primary} type="button" className="btn btn-primary" onClick={onNext}>
              {last ? labels.done : labels.next}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
