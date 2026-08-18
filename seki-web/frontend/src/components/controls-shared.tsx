import { useEffect, useRef, useState } from "preact/hooks";
import type { NavAction } from "../goban/create-board";
import {
  IconBalance,
  IconBot,
  IconCheck,
  IconRenew,
  IconSpinner,
  IconX,
} from "./icons";

export type ButtonDef = {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
  collapses?: boolean;
};

export type ConfirmDef = {
  message: string;
  onConfirm: () => void;
  pending?: "confirm" | "cancel";
  closeOnConfirm?: boolean;
};

export type ControlsProps = {
  layout?: "analysis" | "analysis-review";
  compact?: boolean;

  // Nav bar
  nav?: {
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
    isRanked?: boolean;
  };
  aiSuggest?: ButtonDef;
  analyze?: ButtonDef & { active?: boolean };
  estimate?: ButtonDef;
  exitEstimate?: ButtonDef;

  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  confirmMove?: ButtonDef;

  newGame?: ButtonDef;

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

export function AiBtn(props?: ButtonDef) {
  if (!props) return null;
  return (
    <button
      class={props.active ? "btn-on" : ""}
      title={props.title ?? "AI suggestion"}
      disabled={props.disabled || props.pending}
      onClick={props.onClick}
    >
      <ButtonContent pending={props.pending} icon={IconBot} />
    </button>
  );
}

export function EstimateBtn(props: ButtonDef) {
  return (
    <button
      class={props.active ? "btn-on" : ""}
      title={props.title ?? "Estimate score"}
      disabled={props.disabled || props.pending}
      onClick={props.onClick}
    >
      <ButtonContent pending={props.pending} icon={IconBalance} />
    </button>
  );
}

export function NewGameBtn(props: ButtonDef) {
  return (
    <button
      class={props.active ? "btn-on" : ""}
      title={props.title ?? "New game"}
      disabled={props.disabled || props.pending}
      onClick={props.onClick}
    >
      <ButtonContent pending={props.pending} icon={IconRenew} />
    </button>
  );
}

export function CopyInviteLinkButton({ onClick }: { onClick: () => void }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (
    <button
      class="btn-raised"
      title="Copy access link"
      onClick={() => {
        onClick();
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setCopied(false);
        }, 1500);
      }}
    >
      {copied ? "Copied!" : "Invite"}
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

export function HandicapSelect({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  disabled?: boolean;
  onChange: (handicap: number) => void;
}) {
  return (
    <select
      name="handicap"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseInt(e.currentTarget.value, 10))}
    >
      <option value={0}>None</option>
      {Array.from({ length: Math.max(0, max - 1) }, (_, i) => {
        const v = i + 2;
        return (
          <option key={v} value={v}>
            {v}
          </option>
        );
      })}
    </select>
  );
}
