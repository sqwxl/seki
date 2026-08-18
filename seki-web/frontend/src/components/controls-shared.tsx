import { useEffect, useRef, useState } from "preact/hooks";
import type { NavAction } from "../goban/create-board";
import { IconBalance, IconBot, IconRenew, IconSpinner } from "./icons";
import { ToggleButton } from "./toggle-button";

export {
  closeOnCancelHandler,
  ConfirmButton,
  ConfirmModal,
  ConfirmPopover,
  ModalConfirmPopover,
} from "./confirm-button";
export { QuickConfirmButton } from "./quick-confirm-button";

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

export function AiBtn(props?: ButtonDef) {
  if (!props) return null;
  return (
    <ToggleButton
      enabled={!!props.active}
      onToggle={props.onClick}
      title={props.title ?? "AI suggestion"}
      disabled={props.disabled || props.pending}
    >
      <ButtonContent pending={props.pending} icon={IconBot} />
    </ToggleButton>
  );
}

export function EstimateBtn(props: ButtonDef) {
  return (
    <ToggleButton
      enabled={!!props.active}
      onToggle={props.onClick}
      title={props.title ?? "Estimate score"}
      disabled={props.disabled || props.pending}
    >
      <ButtonContent pending={props.pending} icon={IconBalance} />
    </ToggleButton>
  );
}

export function NewGameBtn(props: ButtonDef) {
  return (
    <button
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
