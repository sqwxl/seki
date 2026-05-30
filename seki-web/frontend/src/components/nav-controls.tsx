import type { ControlsProps } from "./controls-shared";
import { IconNext, IconPrev } from "./icons";

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
        class="btn-raised controls-nav-prev"
        title="Back"
        disabled={nav.atStart}
        onClick={() => nav.onNavigate("back")}
      >
        <IconPrev />
      </button>
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
      <button
        class="btn-raised controls-nav-next"
        title="Forward"
        disabled={nav.atLatest}
        onClick={() => nav.onNavigate("forward")}
      >
        <IconNext />
      </button>
    </div>
  );
}
