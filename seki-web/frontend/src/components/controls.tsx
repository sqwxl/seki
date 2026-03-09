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
} from "./icons";

type ButtonDef = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

type ConfirmDef = {
  message: string;
  onConfirm: () => void;
};

export type ControlsProps = {
  layout?: "analysis";

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
  undoResponse?: { onAccept: () => void; onReject: () => void };
  resign?: ConfirmDef & { disabled?: boolean };

  abort?: ConfirmDef & { disabled?: boolean };
  claimVictory?: ConfirmDef & { disabled?: boolean };
  acceptTerritory?: ConfirmDef & { disabled?: boolean };
  acceptChallenge?: ButtonDef;
  declineChallenge?: ConfirmDef & { disabled?: boolean };
  rematch?: { onConfirm: (swapColors: boolean) => void; disabled?: boolean };
  analyze?: ButtonDef;
  exitAnalysis?: ButtonDef;
  estimate?: ButtonDef;
  exitEstimate?: ButtonDef;
  sgfImport?: { onFileChange: (input: HTMLInputElement) => void };
  sgfExport?: ButtonDef;

  sizeSelect?: {
    value: number;
    options: number[];
    onChange: (size: number) => void;
  };

  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  confirmMove?: ButtonDef;

  // Presentation
  controlRequestResponse?: {
    displayName: string;
    onGive: () => void;
    onDismiss: () => void;
  };
  analyzeChoice?: {
    options: Array<{ label: string; onClick: () => void; disabled?: boolean }>;
  };
};

function ConfirmPopover({
  id,
  icon,
  message,
  onConfirm,
  onCancel,
  manual,
  children,
}: {
  id: string;
  icon: preact.ComponentType<{ title?: string }>;
  message: string;
  onConfirm: () => void;
  onCancel?: () => void;
  manual?: boolean;
  children?: preact.ComponentChildren;
}) {
  const Icon = icon;
  return (
    <div
      id={id}
      class="confirm-popover"
      popover={manual ? "manual" : "auto"}
      ref={
        manual
          ? (el) => {
              if (el && !el.matches(":popover-open")) {
                el.showPopover();
              }
            }
          : undefined
      }
    >
      <Icon />
      <p>{message}</p>
      {children}
      <div class="confirm-actions">
        <button
          class="btn-success"
          popovertarget={manual ? undefined : id}
          onClick={() => {
            onConfirm();
            if (manual) {
              document.getElementById(id)?.hidePopover();
            }
          }}
        >
          <IconCheck />
        </button>
        <button
          class="btn-warn"
          popovertarget={manual ? undefined : id}
          onClick={() => {
            onCancel?.();
            if (manual) {
              document.getElementById(id)?.hidePopover();
            }
          }}
        >
          <IconX />
        </button>
      </div>
    </div>
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
  const popoverId = `${id}-confirm`;
  const Icon = icon;
  return (
    <>
      <button
        id={id}
        class={buttonClass}
        popovertarget={popoverId}
        title={title}
        disabled={disabled}
      >
        <Icon />
      </button>
      <ConfirmPopover
        id={popoverId}
        icon={icon}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
      >
        {children}
      </ConfirmPopover>
    </>
  );
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

function SizeSelect({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (size: number) => void;
}) {
  return (
    <select
      title="Board size"
      value={String(value)}
      onChange={(e) =>
        onChange(parseInt((e.target as HTMLSelectElement).value, 10))
      }
    >
      {options.map((s) => (
        <option key={s} value={String(s)}>
          {s}×{s}
        </option>
      ))}
    </select>
  );
}

export function GameControls(props: ControlsProps) {
  return (
    <>
      {props.requestUndo && (
        <button
          title={props.requestUndo.title ?? "Undo"}
          disabled={props.requestUndo.disabled}
          onClick={props.requestUndo.onClick}
        >
          <IconUndo />
        </button>
      )}
      {props.undoResponse && (
        <ConfirmPopover
          id="undo-response"
          icon={IconUndo}
          message="Opponent requests to undo their last move."
          onConfirm={props.undoResponse.onAccept}
          onCancel={props.undoResponse.onReject}
          manual
        />
      )}
      {props.pass && !props.confirmPass && (
        <button
          class="btn-pass"
          title={props.pass.title ?? "Pass"}
          disabled={props.pass.disabled}
          onClick={props.pass.onClick}
        >
          <IconPass />
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
      {props.acceptTerritory && (
        <ConfirmButton
          id="accept-territory-btn"
          icon={() => <>Accept</>}
          title="Accept territory"
          disabled={props.acceptTerritory.disabled}
          confirm={props.acceptTerritory}
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
          }}
        >
          <label>
            <input type="checkbox" id="rematch-swap" /> Swap colors
          </label>
        </ConfirmButton>
      )}
      {props.controlRequestResponse && (
        <ConfirmPopover
          id="control-request"
          icon={IconAnalysis}
          message={`${props.controlRequestResponse.displayName} requests control`}
          onConfirm={props.controlRequestResponse.onGive}
          onCancel={props.controlRequestResponse.onDismiss}
          manual
        />
      )}
    </>
  );
}

export function NavControls({
  nav,
  confirmMove,
}: {
  nav: ControlsProps["nav"];
  confirmMove?: ButtonDef;
}) {
  const confirming = !!confirmMove;
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
          confirming ? "controls-counter controls-confirm" : "controls-counter"
        }
        title={confirming ? "Confirm move" : "Go to end of main line"}
        disabled={confirming ? confirmMove.disabled : nav.atMainEnd}
        onClick={
          confirming ? confirmMove.onClick : () => nav.onNavigate("main-end")
        }
      >
        {confirming ? <IconCheck /> : nav.counter}
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
  return (
    <>
      {!props.excludeAnalysis && (
        <span class="analysis-toggle">
          {props.analyze && props.analyzeChoice && (
            <>
              <button
                title={props.analyze.title ?? "Analyze"}
                disabled={props.analyze.disabled}
                popovertarget="analyze-choice"
              >
                <IconAnalysis />
              </button>
              <div id="analyze-choice" popover>
                {props.analyzeChoice.options.map((opt) => (
                  <button
                    key={opt.label}
                    popovertarget={opt.disabled ? undefined : "analyze-choice"}
                    disabled={opt.disabled}
                    onClick={opt.onClick}
                  >
                    {opt.label}
                  </button>
                ))}
                <button popovertarget="analyze-choice">Cancel</button>
              </div>
            </>
          )}
          {props.analyze && !props.analyzeChoice && (
            <button
              title={props.analyze.title ?? "Analyze"}
              disabled={props.analyze.disabled}
              onClick={props.analyze.onClick}
            >
              <IconAnalysis />
            </button>
          )}
          {props.exitAnalysis && (
            <button
              title="Back to game"
              disabled={props.exitAnalysis.disabled}
              onClick={props.exitAnalysis.onClick}
            >
              <IconX />
            </button>
          )}
        </span>
      )}
      {props.estimate && (
        <button
          class="btn-estimate"
          title={props.estimate.title ?? "Estimate score"}
          disabled={props.estimate.disabled}
          onClick={props.estimate.onClick}
        >
          <IconBalance />
        </button>
      )}
      {props.exitEstimate && (
        <button
          class="btn-exit-estimate"
          title={props.exitEstimate.title ?? "Back to game"}
          disabled={props.exitEstimate.disabled}
          onClick={props.exitEstimate.onClick}
        >
          <IconX />
        </button>
      )}
      {props.sgfImport && (
        <SgfImportButton onFileChange={props.sgfImport.onFileChange} />
      )}
      {props.sgfExport && (
        <button
          title={props.sgfExport.title ?? "Export SGF"}
          disabled={props.sgfExport.disabled}
          onClick={props.sgfExport.onClick}
        >
          <IconFileExport />
        </button>
      )}
      {props.sizeSelect && (
        <span class="size-select-group">
          <IconGrid4x4 title="Board size" />
          <SizeSelect {...props.sizeSelect} />
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
  onAccept?: () => void;
  onDecline?: () => void;
  onAbort?: () => void;
  onJoin?: () => void;
  copyInviteLink?: () => void;
}) {
  const size = formatSize(settings.cols, settings.rows);
  const tc = formatTimeControl(settings);

  return (
    <div
      id="lobby-popover"
      class="confirm-popover"
      popover="manual"
      ref={(el) => {
        if (el && !el.matches(":popover-open")) {
          el.showPopover();
        }
      }}
    >
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
            <button class="btn-success" onClick={onAccept}>
              Accept
            </button>
            <button class="btn-warn" onClick={onDecline}>
              Decline
            </button>
          </>
        )}
        {variant === "join" && (
          <button class="btn-success" onClick={onJoin}>
            Join
          </button>
        )}
        {(variant === "creator-waiting" || variant === "creator-challenge") && (
          <>
            {copyInviteLink && (
              <CopyInviteLinkButton onClick={copyInviteLink} />
            )}
            <button class="btn-warn" onClick={onAbort}>
              Abort
            </button>
          </>
        )}
      </div>
    </div>
  );
}
