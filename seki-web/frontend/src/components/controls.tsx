import { useEffect, useRef, useState } from "preact/hooks";
import type { NavAction } from "../goban/create-board";
import type { GameSettings } from "../game/types";
import { formatSize, formatTimeControl } from "../utils/format";
import {
  IconPlaybackPrev,
  IconPlaybackRewind,
  IconPlaybackForward,
  IconPlaybackNext,
  IconPass,
  IconBalance,
  IconUndo,
  IconWhiteFlag,
  IconAnalysis,
  IconFileUpload,
  IconFileExport,
  IconCheck,
  IconX,
  IconRepeat,
  IconStonesBw,
  IconCancel,
  IconGrid4x4,
  IconKomi,
  IconSpinner,
} from "./icons";

type ButtonDef = {
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
};

type ConfirmDef = {
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

function ButtonContent(props: {
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

function ConfirmPopover({
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

function ConfirmModal({
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
      <div class="confirm-popover-modal">
        {children}
      </div>
    </>
  );
}

function ConfirmButton({
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

function closeOnCancelHandler(setOpen: (open: boolean) => void) {
  return () => setOpen(false);
}

function SgfImportButton({
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

function CopyInviteLinkButton({ onClick }: { onClick: () => void }) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (
    <button
      title="Copy invite link"
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

function ModalConfirmPopover(
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

export function GameControls(props: ControlsProps) {
  return (
    <>
      {props.requestUndo && (
        <button
          title={props.requestUndo.title ?? "Undo"}
          disabled={props.requestUndo.disabled || props.requestUndo.pending}
          onClick={props.requestUndo.onClick}
        >
          <ButtonContent pending={props.requestUndo.pending} icon={IconUndo} />
        </button>
      )}
      {props.undoResponse ? (
        <ModalConfirmPopover
          icon={IconUndo}
          message="Opponent requests to undo their last move."
          onConfirm={props.undoResponse.onAccept}
          onCancel={props.undoResponse.onReject}
          pending={props.undoResponse.pending}
        />
      ) : null}
      {props.pass && !props.confirmPass && (
        <button
          class="btn-pass"
          title={props.pass.title ?? "Pass"}
          disabled={props.pass.disabled || props.pass.pending}
          onClick={props.pass.onClick}
        >
          <ButtonContent pending={props.pass.pending} icon={IconPass} />
        </button>
      )}
      {props.pass && props.confirmPass && (
        <ConfirmButton
          id="pass-btn"
          icon={IconPass}
          title={props.pass.title ?? "Pass"}
          disabled={props.pass.disabled}
          confirm={props.confirmPass}
        />
      )}
      {props.resign && (
        <ConfirmButton
          id="resign-btn"
          icon={IconWhiteFlag}
          title="Resign"
          disabled={props.resign.disabled}
          confirm={props.resign}
        />
      )}
      {props.rematch && (
        <ConfirmButton
          id="rematch-btn"
          icon={IconRepeat}
          title="Rematch"
          disabled={props.rematch.disabled}
          confirm={{
            message: "Rematch?",
            onConfirm: () => {
              const swap = (
                document.getElementById("rematch-swap") as HTMLInputElement
              ).checked;
              props.rematch!.onConfirm(swap);
            },
            pending: props.rematch.pending,
          }}
        >
          <label>
            <input type="checkbox" id="rematch-swap" /> Swap colors
          </label>
        </ConfirmButton>
      )}
      {props.controlRequestResponse ? (
        <ModalConfirmPopover
          icon={IconAnalysis}
          message={`${props.controlRequestResponse.displayName} requests control`}
          onConfirm={props.controlRequestResponse.onGive}
          onCancel={props.controlRequestResponse.onDismiss}
          pending={props.controlRequestResponse.pending}
        />
      ) : null}
    </>
  );
}

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

export function UIControls(
  props: ControlsProps & { excludeAnalysis?: boolean },
) {
  const [analyzeChoiceOpen, setAnalyzeChoiceOpen] = useState(false);
  const analyzeChoiceRef = useRef<HTMLDivElement>(null);
  const analyzeChoiceButtonRef = useRef<HTMLButtonElement>(null);
  const analyzeChoicePending =
    props.analyzeChoice?.options.some((option) => option.pending) ?? false;

  useEffect(() => {
    if (!analyzeChoiceOpen || analyzeChoicePending) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        analyzeChoiceRef.current?.contains(target) ||
        analyzeChoiceButtonRef.current?.contains(target)
      ) {
        return;
      }
      setAnalyzeChoiceOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [analyzeChoiceOpen, analyzeChoicePending]);

  useEffect(() => {
    if (analyzeChoicePending) {
      setAnalyzeChoiceOpen(true);
    }
  }, [analyzeChoicePending]);

  return (
    <>
      {!props.excludeAnalysis && props.analyze && (
        <span class="analysis-toggle">
          {props.analyzeChoice && !props.analyze.active ? (
            <>
              <button
                ref={analyzeChoiceButtonRef}
                title={props.analyze.title ?? "Analyze"}
                disabled={props.analyze.disabled || analyzeChoicePending}
                onClick={() => setAnalyzeChoiceOpen((value) => !value)}
              >
                <ButtonContent pending={props.analyze.pending} icon={IconAnalysis} />
              </button>
              {analyzeChoiceOpen && (
                <div id="analyze-choice" class="controls-menu-dropdown">
                  {props.analyzeChoice.options.map((opt) => (
                    <button
                      key={opt.label}
                      disabled={opt.disabled || opt.pending || analyzeChoicePending}
                      onClick={() => {
                        opt.onClick();
                      }}
                    >
                      <ButtonContent pending={opt.pending} label={opt.label} />
                    </button>
                  ))}
                  <button
                    disabled={analyzeChoicePending}
                    onClick={() => setAnalyzeChoiceOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          ) : (
            <button
              class={props.analyze.active ? "active" : undefined}
              title={
                props.analyze.active
                  ? "Back to game"
                  : (props.analyze.title ?? "Analyze")
              }
              disabled={props.analyze.disabled || props.analyze.pending}
              onClick={props.analyze.onClick}
            >
              <ButtonContent
                pending={props.analyze.pending}
                icon={props.analyze.active ? IconX : IconAnalysis}
              />
            </button>
          )}
        </span>
      )}
      {props.estimate && (
        <button
          class="btn-estimate"
          title={props.estimate.title ?? "Estimate score"}
          disabled={props.estimate.disabled || props.estimate.pending}
          onClick={props.estimate.onClick}
        >
          <ButtonContent pending={props.estimate.pending} icon={IconBalance} />
        </button>
      )}
      {props.exitEstimate && (
        <button
          class="btn-exit-estimate"
          title={props.exitEstimate.title ?? "Back to game"}
          disabled={props.exitEstimate.disabled || props.exitEstimate.pending}
          onClick={props.exitEstimate.onClick}
        >
          <ButtonContent pending={props.exitEstimate.pending} icon={IconX} />
        </button>
      )}
      {props.sgfImport && (
        <SgfImportButton onFileChange={props.sgfImport.onFileChange} />
      )}
      {props.sgfExport && (
        <button
          title={props.sgfExport.title ?? "Export SGF"}
          disabled={props.sgfExport.disabled || props.sgfExport.pending}
          onClick={props.sgfExport.onClick}
        >
          <ButtonContent pending={props.sgfExport.pending} icon={IconFileExport} />
        </button>
      )}
      {props.sizeSelect && (
        <span class="inline-control-group">
          <IconGrid4x4 title="Board size" />
          <select
            title="Board size"
            value={String(props.sizeSelect.value)}
            onChange={(e) =>
              props.sizeSelect!.onChange(
                parseInt((e.target as HTMLSelectElement).value, 10),
              )
            }
          >
            {props.sizeSelect.options.map((s) => (
              <option key={s} value={String(s)}>
                {s}×{s}
              </option>
            ))}
          </select>
        </span>
      )}
      {props.komiSelect && (
        <span class="inline-control-group">
          <IconKomi title="Komi" />
          <input
            type="number"
            title="Komi"
            value={props.komiSelect.value}
            step={0.5}
            min={-100.5}
            max={100.5}
            onChange={(e) =>
              props.komiSelect!.onChange(parseFloat(e.currentTarget.value) || 0)
            }
          />
        </span>
      )}
    </>
  );
}

export function LobbyControls(props: ControlsProps) {
  const hasAny = props.abort || props.claimVictory;

  if (!hasAny) {
    return null;
  }

  return (
    <div class="lobby-controls">
      {props.abort && (
        <ConfirmButton
          id="abort-btn"
          icon={IconCancel}
          title="Abort game"
          disabled={props.abort.disabled}
          confirm={props.abort}
          buttonClass="btn-warn"
        />
      )}
      {props.claimVictory && (
        <ConfirmButton
          id="claim-victory-btn"
          icon={IconWhiteFlag}
          title="Claim victory (opponent left)"
          disabled={props.claimVictory.disabled}
          confirm={props.claimVictory}
          buttonClass="btn-success"
        />
      )}
    </div>
  );
}

export function LobbyPopover({
  variant,
  title,
  settings,
  komi,
  allowUndo,
  rated = false,
  yourColor,
  pendingAction,
  showAbort = false,
  onAccept,
  onDecline,
  onAbort,
  onJoin,
  copyInviteLink,
}: {
  variant: "creator-waiting" | "creator-challenge" | "challengee" | "join";
  title: string;
  settings: GameSettings;
  komi: number;
  allowUndo: boolean;
  rated?: boolean;
  yourColor?: "Black" | "White" | "Random";
  pendingAction?: "accept" | "decline" | "abort" | "join";
  showAbort?: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
  onAbort?: () => void;
  onJoin?: () => void;
  copyInviteLink?: () => void;
}) {
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);
  const disableActions = pendingAction != null;

  return (
    <ConfirmModal open dismissible={false}>
      <div id="lobby-popover" class="confirm-popover">
        <IconStonesBw />
        <p>
          <strong>{title}</strong>
        </p>
        <dl class="game-info-details" style="margin-top: 0.5em">
          <dt>Rated</dt>
          <dd>{rated ? "Yes" : "No"}</dd>
          {yourColor && (
            <>
              <dt>Your color</dt>
              <dd>{yourColor}</dd>
            </>
          )}
          <dt>Board</dt>
          <dd>{size}</dd>
          <dt>Komi</dt>
          <dd>{String(komi)}</dd>
          <dt>Handicap</dt>
          <dd>{settings.handicap >= 2 ? String(settings.handicap) : "None"}</dd>
          <dt>Time</dt>
          <dd>{tc || "Unlimited"}</dd>
          <dt>Takebacks</dt>
          <dd>{allowUndo ? "Yes" : "No"}</dd>
        </dl>
        <div class="confirm-actions">
          {variant === "challengee" && (
            <>
              <button
                class="btn-success"
                disabled={disableActions}
                onClick={onAccept}
              >
                <ButtonContent
                  pending={pendingAction === "accept"}
                  label="Accept"
                />
              </button>
              <button
                class="btn-warn"
                disabled={disableActions}
                onClick={onDecline}
              >
                <ButtonContent
                  pending={pendingAction === "decline"}
                  label="Decline"
                />
              </button>
            </>
          )}
          {variant === "join" && (
            <button
              class="btn-success"
              disabled={disableActions}
              onClick={onJoin}
            >
              <ButtonContent pending={pendingAction === "join"} label="Join" />
            </button>
          )}
          {(variant === "creator-waiting" || variant === "creator-challenge") && (
            <>
              {copyInviteLink && (
                <CopyInviteLinkButton onClick={copyInviteLink} />
              )}
              {showAbort && (
                <button
                  class="btn-warn"
                  disabled={disableActions}
                  onClick={onAbort}
                >
                  <ButtonContent pending={pendingAction === "abort"} label="Abort" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </ConfirmModal>
  );
}
