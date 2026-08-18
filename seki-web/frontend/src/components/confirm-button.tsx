import { useEffect, useRef, useState } from "preact/hooks";
import { ButtonContent, type ConfirmDef } from "./controls-shared";
import { IconCheck, IconX } from "./icons";

export function ConfirmPopover({
  icon,
  message,
  onConfirm,
  onCancel,
  pending,
  closeOnCancel = true,
  children,
  popoverRef,
  focusOnMount,
}: {
  icon: preact.ComponentType<{ title?: string }>;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  pending?: "confirm" | "cancel";
  closeOnCancel?: boolean;
  children?: preact.ComponentChildren;
  popoverRef?: preact.Ref<HTMLDivElement>;
  focusOnMount?: "confirm" | "cancel";
}) {
  const Icon = icon;
  const disableActions = pending != null;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const trapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusOnMount === "confirm") {
      confirmRef.current?.focus();
    } else if (focusOnMount === "cancel") {
      cancelRef.current?.focus();
    }
  }, []);

  const setRef = (el: HTMLDivElement | null) => {
    trapRef.current = el;
    if (typeof popoverRef === "function") {
      popoverRef(el);
    } else if (popoverRef) {
      (popoverRef as preact.RefObject<HTMLDivElement>).current = el;
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;

    const focusable = trapRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div class="confirm-popover" ref={setRef} onKeyDown={handleKeyDown}>
      <Icon />
      <p>{message}</p>
      {children}
      <div class="confirm-actions">
        <button
          ref={confirmRef}
          class="btn btn-success"
          disabled={disableActions}
          onClick={() => {
            onConfirm();
          }}
        >
          <ButtonContent pending={pending === "confirm"} icon={IconCheck} />
        </button>
        <button
          ref={cancelRef}
          class="btn btn-warn"
          disabled={disableActions}
          onClick={() => {
            onCancel?.();
          }}
        >
          <ButtonContent pending={pending === "cancel"} icon={IconX} />
        </button>
      </div>
    </div>
  );
}

export function ConfirmModal({
  open,
  dismissible = true,
  onDismiss,
  children,
}: {
  open: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
  children: preact.ComponentChildren;
}) {
  if (!open) {
    return null;
  }

  return (
    <>
      <div
        class={`confirm-popover-backdrop${dismissible ? " dismissible" : ""}`}
        onClick={dismissible ? onDismiss : undefined}
      />
      <div class="confirm-popover-modal">{children}</div>
    </>
  );
}

export function ConfirmButton({
  id,
  icon,
  label,
  title,
  disabled,
  confirm,
  buttonClass,
  focusOnMount,
  children,
}: {
  id: string;
  icon: preact.ComponentType<{ title?: string }>;
  label?: string;
  title: string;
  disabled?: boolean;
  confirm: ConfirmDef;
  buttonClass?: string;
  focusOnMount?: "confirm" | "cancel";
  children?: preact.ComponentChildren;
}) {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const wasPendingRef = useRef(false);
  const isPending = confirm.pending != null;

  useEffect(() => {
    if (isPending) {
      setOpen(true);
    } else if (wasPendingRef.current) {
      setOpen(false);
    }

    wasPendingRef.current = isPending;
  }, [isPending]);

  return (
    <>
      <button
        id={id}
        ref={buttonRef}
        class={buttonClass || "btn-raised"}
        title={title}
        disabled={disabled || isPending}
        onClick={() => setOpen((value) => !value)}
      >
        <ButtonContent pending={isPending} icon={Icon} label={label} />
      </button>
      <ConfirmModal
        open={open}
        dismissible={!isPending}
        onDismiss={() => setOpen(false)}
      >
        <ConfirmPopover
          key={id}
          icon={icon}
          message={confirm.message}
          onConfirm={() => {
            confirm.onConfirm();
            if (confirm.closeOnConfirm) {
              setOpen(false);
            }
          }}
          onCancel={closeOnCancelHandler(setOpen)}
          pending={confirm.pending}
          popoverRef={popoverRef}
          focusOnMount={focusOnMount}
        >
          {children}
        </ConfirmPopover>
      </ConfirmModal>
    </>
  );
}

export function closeOnCancelHandler(setOpen: (open: boolean) => void) {
  return () => setOpen(false);
}

export function ModalConfirmPopover(
  props:
    | {
        icon: preact.ComponentType<{ title?: string }>;
        message: string;
        onConfirm: () => void;
        onCancel: () => void;
        pending?: "confirm" | "cancel";
      }
    | undefined,
) {
  if (!props) {
    return null;
  }

  return (
    <ConfirmModal open dismissible={false}>
      <ConfirmPopover
        icon={props.icon}
        message={props.message}
        onConfirm={props.onConfirm}
        onCancel={props.onCancel}
        pending={props.pending}
        closeOnCancel={false}
      />
    </ConfirmModal>
  );
}
