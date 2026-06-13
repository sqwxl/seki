import { useEffect, useRef } from "preact/hooks";
import type { ControlsProps } from "./controls-shared";
import { IconNext, IconPrev } from "./icons";

const HOLD_NAV_DELAY_MS = 300;
const HOLD_NAV_PHASES_MS = [
  [250, 200],
  [250, 125],
  [250, 50],
  [Infinity, 25],
] as const satisfies readonly [durationMs: number, intervalMs: number][];

function holdNavInterval(elapsedMs: number) {
  let phaseStartMs = 0;

  for (const [durationMs, intervalMs] of HOLD_NAV_PHASES_MS) {
    if (elapsedMs < phaseStartMs + durationMs) {
      return intervalMs;
    }

    phaseStartMs += durationMs;
  }

  return HOLD_NAV_PHASES_MS[HOLD_NAV_PHASES_MS.length - 1][1];
}

function HoldNavButton({
  action,
  className,
  disabled,
  onNavigate,
  title,
  children,
}: {
  action: "back" | "forward";
  className: string;
  disabled: boolean;
  onNavigate: ControlsProps["nav"]["onNavigate"];
  title: string;
  children: preact.ComponentChildren;
}) {
  const delayRef = useRef<ReturnType<typeof window.setTimeout> | undefined>();
  const repeatRef = useRef<ReturnType<typeof window.setTimeout> | undefined>();
  const pointerActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const disabledRef = useRef(disabled);

  disabledRef.current = disabled;

  const clearTimers = () => {
    if (delayRef.current) {
      window.clearTimeout(delayRef.current);
      delayRef.current = undefined;
    }

    if (repeatRef.current) {
      window.clearTimeout(repeatRef.current);
      repeatRef.current = undefined;
    }
  };

  const navigate = () => {
    if (!disabledRef.current) {
      onNavigate(action);
    }
  };

  const stopHold = () => {
    pointerActiveRef.current = false;
    clearTimers();
    window.removeEventListener("pointerup", stopHold);
    window.removeEventListener("pointercancel", stopHold);
  };

  useEffect(() => {
    if (disabled) {
      stopHold();
    }

    return stopHold;
  }, [disabled]);

  return (
    <button
      class={className}
      title={title}
      disabled={disabled}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }

        navigate();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || disabled) {
          return;
        }

        event.preventDefault();
        suppressClickRef.current = true;
        pointerActiveRef.current = true;
        clearTimers();
        navigate();

        window.addEventListener("pointerup", stopHold);
        window.addEventListener("pointercancel", stopHold);

        delayRef.current = window.setTimeout(() => {
          if (!pointerActiveRef.current) {
            return;
          }

          const repeatStart = performance.now();
          const repeat = () => {
            if (!pointerActiveRef.current) {
              return;
            }

            navigate();
            repeatRef.current = window.setTimeout(
              repeat,
              holdNavInterval(performance.now() - repeatStart),
            );
          };

          repeatRef.current = window.setTimeout(repeat, holdNavInterval(0));
        }, HOLD_NAV_DELAY_MS);
      }}
    >
      {children}
    </button>
  );
}

export function NavControls({
  nav,
  counterOverride,
  compact,
}: {
  nav: ControlsProps["nav"];
  counterOverride?: {
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    content: preact.ComponentChildren;
  };
  compact?: boolean;
}) {
  return (
    <>
      <HoldNavButton
        action="back"
        className="btn-raised controls-nav-prev"
        title="Back"
        disabled={nav.atStart}
        onNavigate={nav.onNavigate}
      >
        <IconPrev />
      </HoldNavButton>
      {!compact && (
        <button
          class={
            counterOverride
              ? "btn-raised controls-counter controls-confirm"
              : "btn-raised controls-counter"
          }
          title={counterOverride?.title ?? "Go to end of main line"}
          disabled={counterOverride ? counterOverride.disabled : nav.atMainEnd}
          onClick={
            counterOverride
              ? counterOverride.onClick
              : () => nav.onNavigate("main-end")
          }
        >
          {counterOverride ? counterOverride.content : nav.counter}
        </button>
      )}
      <HoldNavButton
        action="forward"
        className="btn-raised controls-nav-next"
        title="Forward"
        disabled={nav.atLatest}
        onNavigate={nav.onNavigate}
      >
        <IconNext />
      </HoldNavButton>
    </>
  );
}
