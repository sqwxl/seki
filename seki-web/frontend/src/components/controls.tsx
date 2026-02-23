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
  // Layout mode: "analysis" and "live" both use controls-nav-row grid,
  // "analysis" has territory review mode that uses a flat controls-group
  layout?: "analysis";

  // Nav bar
  nav: {
    atStart: boolean;
    atLatest: boolean;
    counter: string;
    onNavigate: (action: NavAction) => void;
  };

  // Action buttons — present = shown, absent = hidden
  pass?: ButtonDef;
  confirmPass?: ConfirmDef;
  score?: ButtonDef;
  requestUndo?: ButtonDef;
  resign?: ConfirmDef & { disabled?: boolean };
  abort?: ConfirmDef & { disabled?: boolean };
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

  // Board size selector (analysis only)
  sizeSelect?: {
    value: number;
    options: number[];
    onChange: (size: number) => void;
  };

  // Territory review (analysis only)
  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  // Toggles
  coordsToggle?: { enabled: boolean; onClick: () => void };
  moveConfirmToggle?: { enabled: boolean; onClick: () => void };
  moveTreeToggle?: { enabled: boolean; onClick: () => void };

  // Undo response popover (auto-shown when present)
  undoResponse?: { onAccept: () => void; onReject: () => void };

  // Copy invite link
  copyInviteLink?: ButtonDef;

  // Confirm move button
  confirmMove?: ButtonDef;
};

function ConfirmButton({
  id,
  icon,
  title,
  disabled,
  confirm,
}: {
  id: string;
  icon: preact.ComponentType;
  title: string;
  disabled?: boolean;
  confirm: ConfirmDef;
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
      <div id={popoverId} popover>
        <p>{confirm.message}</p>
        <button
          class="confirm-yes"
          popovertarget={popoverId}
          onClick={confirm.onConfirm}
        >
          <IconCheck />
        </button>
        <button class="confirm-no" popovertarget={popoverId}>
          <IconX />
        </button>
      </div>
    </>
  );
}

function NavBar({ nav }: { nav: ControlsProps["nav"] }) {
  return (
    <div class="controls-navbar">
      <button
        title="Go to start (Home)"
        disabled={nav.atStart}
        onClick={() => nav.onNavigate("start")}
      >
        <IconPlaybackPrev />
      </button>
      <button
        title="Back (Left)"
        disabled={nav.atStart}
        onClick={() => nav.onNavigate("back")}
      >
        <IconPlaybackRewind />
      </button>
      <span class="controls-counter">{nav.counter}</span>
      <button
        title="Forward (Right)"
        disabled={nav.atLatest}
        onClick={() => nav.onNavigate("forward")}
      >
        <IconPlaybackForward />
      </button>
      <button
        title="Go to latest (End)"
        disabled={nav.atLatest}
        onClick={() => nav.onNavigate("end")}
      >
        <IconPlaybackNext />
      </button>
    </div>
  );
}

function AnalysisControls(props: ControlsProps) {
  const reviewing = !!(props.territoryReady || props.territoryExit);

  if (reviewing) {
    return (
      <div class="controls-group">
        <NavBar nav={props.nav} />
        {props.territoryReady && (
          <button
            onClick={props.territoryReady.onClick}
            disabled={props.territoryReady.disabled}
          >
            Ready
          </button>
        )}
        {props.territoryExit && (
          <button onClick={props.territoryExit.onClick}>Exit</button>
        )}
      </div>
    );
  }

  const hasFileButtons = !!(props.sgfImport || props.sgfExport || props.sizeSelect);

  return (
    <div class="controls-nav-row">
      {hasFileButtons && (
        <span class="btn-group controls-start">
          {props.sgfImport && (
            <SgfImportButton onFileChange={props.sgfImport.onFileChange} />
          )}
          {props.sgfExport && (
            <button
              title={props.sgfExport.title ?? "Export as SGF file"}
              onClick={props.sgfExport.onClick}
            >
              <IconFileExport />
            </button>
          )}
          {props.sizeSelect && (
            <SizeSelect {...props.sizeSelect} />
          )}
        </span>
      )}
      <NavBar nav={props.nav} />
      <span class="btn-group controls-end">
        {props.pass && (
          <button
            title={props.pass.title ?? "Pass"}
            disabled={props.pass.disabled}
            onClick={props.pass.onClick}
          >
            <IconPass />
          </button>
        )}
        {props.score && (
          <button
            title={props.score.title ?? "Estimate score"}
            disabled={props.score.disabled}
            onClick={props.score.onClick}
          >
            <IconBalance />
          </button>
        )}
        <ToggleButtons
          coordsToggle={props.coordsToggle}
          moveConfirmToggle={props.moveConfirmToggle}
          moveTreeToggle={props.moveTreeToggle}
        />
      </span>
    </div>
  );
}

function LiveControls(props: ControlsProps) {
  return (
    <div class="controls-nav-row">
      <span class="btn-group controls-start">
        {props.requestUndo && (
          <button
            title={props.requestUndo.title ?? "Undo"}
            disabled={props.requestUndo.disabled}
            onClick={props.requestUndo.onClick}
          >
            <IconUndo />
          </button>
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
          <button
            title="Join game"
            onClick={props.joinGame.onClick}
          >
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
      </span>
      <span class="btn-group controls-navbar-extra">
        {props.analyze && (
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
        <NavBar nav={props.nav} />
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
        {props.sgfExport && (
          <button
            title={props.sgfExport.title ?? "Export SGF"}
            disabled={props.sgfExport.disabled}
            onClick={props.sgfExport.onClick}
          >
            <IconFileExport />
          </button>
        )}
      </span>
      <span class="btn-group controls-end">
        {props.rematch && (
          <>
            <button
              id="rematch-btn"
              popovertarget="rematch-confirm"
              title="Rematch"
              disabled={props.rematch.disabled}
            >
              <IconRepeat />
            </button>
            <div id="rematch-confirm" popover>
              <p>Rematch?</p>
              <label>
                <input type="checkbox" id="rematch-swap" />
                {" "}Swap colors
              </label>
              <button
                class="confirm-yes"
                popovertarget="rematch-confirm"
                onClick={() => {
                  const swap = (
                    document.getElementById("rematch-swap") as HTMLInputElement
                  ).checked;
                  props.rematch!.onConfirm(swap);
                }}
              >
                <IconCheck />
              </button>
              <button class="confirm-no" popovertarget="rematch-confirm">
                <IconX />
              </button>
            </div>
          </>
        )}
        <ToggleButtons
          coordsToggle={props.coordsToggle}
          moveTreeToggle={props.moveTreeToggle}
        />
      </span>
    </div>
  );
}

export function Controls(props: ControlsProps) {
  return (
    <>
      {props.layout === "analysis" ? (
        <AnalysisControls {...props} />
      ) : (
        <LiveControls {...props} />
      )}
      {props.undoResponse && (
        <div
          id="undo-response"
          popover="manual"
          ref={(el) => {
            if (el && !el.matches(":popover-open")) {
              el.showPopover();
            }
          }}
        >
          <p>Opponent requests to undo their last move.</p>
          <button
            class="confirm-yes"
            onClick={() => {
              document.getElementById("undo-response")?.hidePopover();
              props.undoResponse!.onAccept();
            }}
          >
            <IconCheck />
          </button>
          <button
            class="confirm-no"
            onClick={() => {
              document.getElementById("undo-response")?.hidePopover();
              props.undoResponse!.onReject();
            }}
          >
            <IconX />
          </button>
        </div>
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

function ToggleButtons({
  coordsToggle,
  moveConfirmToggle,
  moveTreeToggle,
}: {
  coordsToggle?: ControlsProps["coordsToggle"];
  moveConfirmToggle?: ControlsProps["moveConfirmToggle"];
  moveTreeToggle?: ControlsProps["moveTreeToggle"];
}) {
  return (
    <>
      {coordsToggle && (
        <button title="Toggle coordinates" onClick={coordsToggle.onClick}>
          A1
        </button>
      )}
      {moveConfirmToggle && (
        <button
          title={
            moveConfirmToggle.enabled
              ? "Move confirmation: ON (click to disable)"
              : "Move confirmation: OFF (click to enable)"
          }
          onClick={moveConfirmToggle.onClick}
        >
          {moveConfirmToggle.enabled ? (
            <IconTouchDouble />
          ) : (
            <IconTouchSingle />
          )}
        </button>
      )}
      {moveTreeToggle && (
        <button
          title={moveTreeToggle.enabled ? "Hide move tree" : "Show move tree"}
          onClick={moveTreeToggle.onClick}
        >
          <IconGraph />
        </button>
      )}
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
      onChange={(e) => onChange(parseInt((e.target as HTMLSelectElement).value, 10))}
    >
      {options.map((s) => (
        <option key={s} value={String(s)}>
          {s}×{s}
        </option>
      ))}
    </select>
  );
}
