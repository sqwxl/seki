import type { ControlsProps } from "./controls-shared";
import {
  IconPlaybackForward,
  IconPlaybackNext,
  IconPlaybackPrev,
  IconPlaybackRewind,
} from "./icons";

export function NavControls({
  nav,
  counterOverride,
}: {
  nav: ControlsProps["nav"];
  counterOverride?: {
    onClick: () => void;
    disabled?: boolean;
    title?: string;
    content: preact.ComponentChildren;
  };
}) {
  return (
    <div class="controls-nav">
      <button
        title="Go to start"
        disabled={nav.atStart}
        onClick={() => nav.onNavigate("start")}
      >
        <IconPlaybackRewind />
      </button>
      <button
        title="Back"
        disabled={nav.atStart}
        onClick={() => nav.onNavigate("back")}
      >
        <IconPlaybackPrev />
      </button>
      <button
        class={
          counterOverride
            ? "controls-counter controls-confirm"
            : "controls-counter"
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
      <button
        title="Forward"
        disabled={nav.atLatest}
        onClick={() => nav.onNavigate("forward")}
      >
        <IconPlaybackNext />
      </button>
      <button
        title="Go to latest"
        disabled={nav.atLatest}
        onClick={() => nav.onNavigate("end")}
      >
        <IconPlaybackForward />
      </button>
    </div>
  );
}
