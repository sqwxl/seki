import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { IconMenu } from "./icons";

export function ControlsMenu({ children }: { children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("click", onClickOutside, true);

    return () => document.removeEventListener("click", onClickOutside, true);
  }, [open]);

  return (
    <div class="controls-menu" ref={ref}>
      <button
        type="button"
        title="More controls"
        onClick={() => setOpen(!open)}
      >
        <IconMenu />
      </button>
      {open && <div class="controls-menu-dropdown">{children}</div>}
    </div>
  );
}
