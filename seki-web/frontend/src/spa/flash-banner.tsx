import { useEffect, useState } from "preact/hooks";
import { activeFlash } from "../utils/flash";

export function FlashBanner() {
  const flash = activeFlash.value;
  const [renderedFlash, setRenderedFlash] = useState(flash);
  const [leaving, setLeaving] = useState(false);

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
      class={`flash-banner flash-banner-${renderedFlash.severity} ${leaving ? "flash-banner-leaving" : ""}`}
      role="alert"
      aria-live="assertive"
    >
      <div class="flash-banner-body">{renderedFlash.message}</div>
    </div>
  );
}
