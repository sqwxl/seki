import { useEffect, useRef, useState } from "preact/hooks";
import { activeFlash, clearFlash } from "../utils/flash";

export function FlashBanner() {
  const flash = activeFlash.value;
  const [renderedFlash, setRenderedFlash] = useState(flash);
  const [leaving, setLeaving] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!renderedFlash) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (bannerRef.current?.contains(event.target as Node)) {
        return;
      }

      clearFlash();
    };

    window.addEventListener("pointerdown", onPointerDown);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [renderedFlash]);

  useEffect(() => {
    if (flash) {
      setRenderedFlash(flash);
      setLeaving(false);

      return;
    }

    if (!renderedFlash) {
      return;
    }

    setLeaving(true);

    const timeout = window.setTimeout(() => {
      setRenderedFlash(undefined);
      setLeaving(false);
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [flash, renderedFlash]);

  if (!renderedFlash) {
    return null;
  }

  return (
    <div
      ref={bannerRef}
      class={`flash-banner flash-banner-${renderedFlash.severity} ${leaving ? "flash-banner-leaving" : ""}`}
      role="alert"
      aria-live="assertive"
    >
      <div class="flash-banner-body">{renderedFlash.message}</div>
    </div>
  );
}
