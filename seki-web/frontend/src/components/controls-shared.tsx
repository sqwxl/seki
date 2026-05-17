import { useEffect, useRef, useState } from "preact/hooks";
import type { NavAction } from "../goban/create-board";
import { IconCheck, IconFileUpload, IconSpinner, IconX } from "./icons";

export type ButtonDef = {
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
};

export type ConfirmDef = {
  message: string;
  onConfirm: () => void;
  pending?: "confirm" | "cancel";
};

export type ControlsProps = {
  layout?: "analysis" | "analysis-review";

  // Nav bar
  nav: {
    atStart: boolean;
    atLatest: boolean;
    atMainEnd: boolean;
    counter: string;
    onNavigate: (action: NavAction) => void;
  };

  pass?: ButtonDef;
  confirmPass?: ConfirmDef;
  requestUndo?: ButtonDef;
  undoResponse?: {
    onAccept: () => void;
    onReject: () => void;
    pending?: "confirm" | "cancel";
  };
  resign?: ConfirmDef & { disabled?: boolean };

  abort?: ConfirmDef & { disabled?: boolean };
  claimVictory?: ConfirmDef & { disabled?: boolean };
  acceptTerritory?: ButtonDef;
  acceptChallenge?: ButtonDef;
  declineChallenge?: ConfirmDef & { disabled?: boolean };
  rematch?: {
    onConfirm: (swapColors: boolean) => void;
    disabled?: boolean;
    pending?: "confirm" | "cancel";
  };
  analyze?: ButtonDef & { active?: boolean };
  estimate?: ButtonDef;
  exitEstimate?: ButtonDef;
  sgfImport?: { onFileChange: (input: HTMLInputElement) => void };
  sgfExport?: ButtonDef;

  sizeSelect?: {
    value: number;
    options: number[];
    onChange: (size: number) => void;
  };

  komiSelect?: {
    value: number;
    onChange: (komi: number) => void;
  };

  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  confirmMove?: ButtonDef;

  // Presentation
  controlRequestResponse?: {
    displayName: string;
    onGive: () => void;
    onDismiss: () => void;
    pending?: "confirm" | "cancel";
  };
  analyzeChoice?: {
    options: Array<{
      label: string;
      onClick: () => void;
      disabled?: boolean;
      pending?: boolean;
    }>;
  };
};

export function ButtonContent(props: {
  icon?: preact.ComponentType<{ title?: string }>;
  label?: string;
  pending?: boolean;
}) {
  const Icon = props.icon;
  if (props.pending) {
    return <IconSpinner />;
  }
  return (
    <>
      {Icon ? <Icon /> : null}
      {props.label ? <span>{props.label}</span> : null}
    </>
  );
}

export function ConfirmPopover({
  icon,
  message,
  onConfirm,
  onCancel,
  pending,
  closeOnCancel = true,
  children,
}: {
  icon: preact.ComponentType<{ title?: string }>;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  pending?: "confirm" | "cancel";
  closeOnCancel?: boolean;
  children?: preact.ComponentChildren;
}) {
  const Icon = icon;
  const disableActions = pending != null;
  return (
    <div class="confirm-popover">
      <Icon />
      <p>{message}</p>
      {children}
      <div class="confirm-actions">
        <button
          class="btn-success"
          disabled={disableActions}
          onClick={() => {
            onConfirm();
          }}
        >
          <ButtonContent pending={pending === "confirm"} icon={IconCheck} />
        </button>
        <button
          class="btn-warn"
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
  title,
  disabled,
  confirm,
  buttonClass,
  children,
}: {
  id: string;
  icon: preact.ComponentType<{ title?: string }>;
  title: string;
  disabled?: boolean;
  confirm: ConfirmDef;
  buttonClass?: string;
  children?: preact.ComponentChildren;
}) {
  const Icon = icon;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (!open || isPending) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, isPending]);

  return (
    <>
      <button
        id={id}
        ref={buttonRef}
        class={buttonClass}
        title={title}
        disabled={disabled || isPending}
        onClick={() => setOpen((value) => !value)}
      >
        <ButtonContent pending={isPending} icon={Icon} />
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
          onConfirm={confirm.onConfirm}
          onCancel={closeOnCancelHandler(setOpen)}
          pending={confirm.pending}
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

export function SgfImportButton({
  onFileChange,
}: {
  onFileChange: (input: HTMLInputElement) => void;
}) {
  return (
    <>
      <button
        title="Import SGF file"
        onClick={() => {
          (document.getElementById("sgf-import") as HTMLInputElement)?.click();
        }}
      >
        <IconFileUpload />
      </button>
      <input
        type="file"
        id="sgf-import"
        accept=".sgf,.SGF"
        hidden
        onChange={(e) => onFileChange(e.currentTarget as HTMLInputElement)}
      />
    </>
  );
}

export function CopyInviteLinkButton({ onClick }: { onClick: () => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (
    <button
      title="Copy access link"
      onClick={(e) => {
        onClick();
        const btn = e.currentTarget;
        btn.textContent = "Copied!";
        clearTimeout(timer);
        timer = setTimeout(() => {
          btn.textContent = "Invite";
        }, 1500);
      }}
    >
      Invite
    </button>
  );
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
