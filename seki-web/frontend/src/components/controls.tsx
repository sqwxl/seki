import type { NavAction } from "../goban/create-board";
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
  IconTouchSingle,
  IconTouchDouble,
  IconGraph,
  IconRepeat,
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
    counter: string;
    onNavigate: (action: NavAction) => void;
  };

  pass?: ButtonDef;
  confirmPass?: ConfirmDef;
  requestUndo?: ButtonDef;
  undoResponse?: { onAccept: () => void; onReject: () => void };
  resign?: ConfirmDef & { disabled?: boolean };

  abort?: ConfirmDef & { disabled?: boolean };
  disconnectAbort?: ConfirmDef & { disabled?: boolean };
  acceptTerritory?: ConfirmDef & { disabled?: boolean };
  joinGame?: ButtonDef;
  acceptChallenge?: ButtonDef;
  declineChallenge?: ConfirmDef & { disabled?: boolean };
  rematch?: { onConfirm: (swapColors: boolean) => void; disabled?: boolean };
  analyze?: ButtonDef;
  exitAnalysis?: ButtonDef;
  estimate?: ButtonDef;
  exitEstimate?: ButtonDef;
  sgfImport?: { onFileChange: (input: HTMLInputElement) => void };
  sgfExport?: ButtonDef;

  copyInviteLink?: ButtonDef;

  sizeSelect?: {
    value: number;
    options: number[];
    onChange: (size: number) => void;
  };

  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  coordsToggle?: { enabled: boolean; onClick: () => void };
  moveConfirmToggle?: { enabled: boolean; onClick: () => void };
  moveTreeToggle?: { enabled: boolean; onClick: () => void };
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
  icon: preact.ComponentType;
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
          class="confirm-yes"
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
          class="confirm-no"
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
  children,
}: {
  id: string;
  icon: preact.ComponentType;
  title: string;
  disabled?: boolean;
  confirm: ConfirmDef;
  children?: preact.ComponentChildren;
}) {
  const popoverId = `${id}-confirm`;
  const Icon = icon;
  return (
    <>
      <button
        id={id}
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
      {props.abort && (
        <ConfirmButton
          id="abort-btn"
          icon={() => <>Abort</>}
          title="Abort game"
          disabled={props.abort.disabled}
          confirm={props.abort}
        />
      )}
      {props.disconnectAbort && (
        <ConfirmButton
          id="disconnect-abort-btn"
          icon={() => <>Abort</>}
          title="Abort game (opponent disconnected)"
          disabled={props.disconnectAbort.disabled}
          confirm={props.disconnectAbort}
        />
      )}
      {props.copyInviteLink && (
        <CopyInviteLinkButton onClick={props.copyInviteLink.onClick} />
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
      {props.joinGame && (
        <button title="Join game" onClick={props.joinGame.onClick}>
          Join
        </button>
      )}
      {props.acceptChallenge && (
        <button
          title="Accept challenge"
          disabled={props.acceptChallenge.disabled}
          onClick={props.acceptChallenge.onClick}
        >
          Accept
        </button>
      )}
      {props.declineChallenge && (
        <ConfirmButton
          id="decline-challenge-btn"
          icon={() => <>Decline</>}
          title="Decline challenge"
          disabled={props.declineChallenge.disabled}
          confirm={props.declineChallenge}
        />
      )}
      {props.moveConfirmToggle && (
        <button
          title={
            props.moveConfirmToggle.enabled
              ? "Move confirmation: ON (click to disable)"
              : "Move confirmation: OFF (click to enable)"
          }
          onClick={props.moveConfirmToggle.onClick}
        >
          {props.moveConfirmToggle.enabled ? (
            <IconTouchDouble />
          ) : (
            <IconTouchSingle />
          )}
        </button>
      )}
      {props.confirmMove && (
        <button
          id="confirm-move-btn"
          title="Confirm move"
          disabled={props.confirmMove.disabled}
          onClick={props.confirmMove.onClick}
        >
          <IconCheck />
        </button>
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

export function NavControls({ nav }: { nav: ControlsProps["nav"] }) {
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
      <span class="controls-counter">{nav.counter}</span>
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

export function UIControls(props: ControlsProps) {
  return (
    <>
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
      {props.estimate && (
        <button
          title={props.estimate.title ?? "Estimate score"}
          disabled={props.estimate.disabled}
          onClick={props.estimate.onClick}
        >
          <IconBalance />
        </button>
      )}
      {props.exitEstimate && (
        <button
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
      {props.coordsToggle && (
        <button title="Toggle coordinates" onClick={props.coordsToggle.onClick}>
          A1
        </button>
      )}
      {props.moveTreeToggle && (
        <button
          title={
            props.moveTreeToggle.enabled ? "Hide move tree" : "Show move tree"
          }
          onClick={props.moveTreeToggle.onClick}
        >
          <IconGraph />
        </button>
      )}
      {props.sizeSelect && <SizeSelect {...props.sizeSelect} />}
    </>
  );
}
