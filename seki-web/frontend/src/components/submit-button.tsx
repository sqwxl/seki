import { useEffect, useRef, useState } from "preact/hooks";
import { clearFlash, setFlash } from "../utils/flash";
import { IconCheck, IconSpinner } from "./icons";

export type SubmitState = "idle" | "busy" | "success";

/**
 * Submit button state machine. run() shows a spinner while the action is in
 * flight, a brief green success state when it resolves, and returns to idle
 * (surfacing the error via flash) when it rejects.
 */
export function useSubmitState(): [
  SubmitState,
  (action: () => Promise<void>) => Promise<void>,
] {
  const [state, setState] = useState<SubmitState>("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  async function run(action: () => Promise<void>): Promise<void> {
    if (state !== "idle") {
      return;
    }
    clearFlash();
    setState("busy");
    try {
      await action();
      setState("success");
      resetTimer.current = window.setTimeout(() => setState("idle"), 1500);
    } catch (err) {
      setState("idle");
      setFlash((err as { message: string }).message);
    }
  }

  return [state, run];
}

export function SubmitButton({
  state,
  idle,
  busy,
  success,
}: {
  state: SubmitState;
  idle: string;
  busy: string;
  success: string;
}) {
  const isBusy = state === "busy";
  const isSuccess = state === "success";
  const label = isBusy ? busy : isSuccess ? success : idle;

  return (
    <button
      type="submit"
      class={`btn${isSuccess ? " btn-success" : ""}`}
      disabled={isBusy || isSuccess}
    >
      {/* Label is a real span, never a bare text node: Firefox fails to
          re-lay out anonymous flex items when button children change. */}
      {isBusy ? <IconSpinner /> : isSuccess ? <IconCheck /> : null}
      <span>{label}</span>
    </button>
  );
}
