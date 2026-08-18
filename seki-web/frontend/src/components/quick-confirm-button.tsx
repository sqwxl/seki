import { useEffect, useRef, useState } from "preact/hooks";
import { ButtonContent, type ConfirmDef } from "./controls-shared";

export function QuickConfirmButton({
  id,
  icon,
  label,
  title,
  disabled,
  confirm,
  buttonClass,
  confirmClass = "btn-warn",
  confirmLabel = "Confirm?",
  confirmIcon = icon,
}: {
  id: string;
  icon: preact.ComponentType<{ title?: string }>;
  label?: string;
  title: string;
  disabled?: boolean;
  confirm: Omit<ConfirmDef, "message">;
  buttonClass?: string;
  confirmClass?: string;
  confirmLabel?: string;
  confirmIcon?: preact.ComponentType<{ title?: string }>;
}) {
  const [armed, setArmed] = useState(false);
  const rootRef = useRef<HTMLButtonElement>(null);
  const isPending = confirm.pending != null;
  const baseClass = buttonClass || "btn-raised";
  const ConfirmIcon = confirmIcon;

  useEffect(() => {
    if (!armed) {
      return;
    }

    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setArmed(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setArmed(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [armed]);

  return (
    <button
      id={id}
      ref={rootRef}
      class={armed ? `${baseClass} ${confirmClass}` : baseClass}
      title={title}
      disabled={disabled || isPending}
      aria-pressed={armed}
      onClick={() => {
        if (armed) {
          confirm.onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
        }
      }}
    >
      <ButtonContent
        pending={isPending}
        icon={armed ? ConfirmIcon : icon}
        label={armed ? confirmLabel : label}
      />
    </button>
  );
}
