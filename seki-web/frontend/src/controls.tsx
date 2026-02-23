import { render } from "preact";
import type { NavAction } from "./board";
import {
  IconPlaybackPrev, IconPlaybackRewind, IconPlaybackForward, IconPlaybackNext,
  IconPass, IconBalance, IconUndo, IconWhiteFlag, IconAnalysis,
  IconFileUpload, IconFileExport, IconCheck, IconX,
  IconTouchSingle, IconTouchDouble, IconGraph,
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
  // Layout mode: "analysis" groups all buttons in a single controls-group,
  // "live" uses nav + action-buttons + btn-group structure
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
  resign?: ConfirmDef;
  abort?: ConfirmDef;
  acceptTerritory?: ConfirmDef & { disabled?: boolean };
  analyze?: ButtonDef;
  exitAnalysis?: ButtonDef;
  estimate?: ButtonDef;
  exitEstimate?: ButtonDef;
  sgfImport?: { onFileChange: (input: HTMLInputElement) => void };
  sgfExport?: ButtonDef;

  // Territory review (analysis only)
  territoryReady?: ButtonDef;
  territoryExit?: ButtonDef;

  // Toggles
  coordsToggle?: { enabled: boolean; onClick: () => void };
  moveConfirmToggle?: { enabled: boolean; onClick: () => void };
  moveTreeToggle?: { enabled: boolean; onClick: () => void };

  // Confirm move button
  confirmMove?: ButtonDef;
};

function ConfirmButton({ id, icon, title, disabled, confirm }: {
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
      <button id={id} popovertarget={popoverId} title={title} disabled={disabled}>
        <Icon />
      </button>
      <div id={popoverId} popover>
        <p>{confirm.message}</p>
        <button class="confirm-yes" popovertarget={popoverId} onClick={confirm.onConfirm}>
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
      <button title="Go to start (Home)" disabled={nav.atStart}
        onClick={() => nav.onNavigate("start")}>
        <IconPlaybackPrev />
      </button>
      <button title="Back (Left)" disabled={nav.atStart}
        onClick={() => nav.onNavigate("back")}>
        <IconPlaybackRewind />
      </button>
      <span style="min-width: 3ch; text-align: center; font-family: monospace">{nav.counter}</span>
      <button title="Forward (Right)" disabled={nav.atLatest}
        onClick={() => nav.onNavigate("forward")}>
        <IconPlaybackForward />
      </button>
      <button title="Go to latest (End)" disabled={nav.atLatest}
        onClick={() => nav.onNavigate("end")}>
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
          <button onClick={props.territoryReady.onClick}
            disabled={props.territoryReady.disabled}>
            Ready
          </button>
        )}
        {props.territoryExit && (
          <button onClick={props.territoryExit.onClick}>Exit</button>
        )}
      </div>
    );
  }

  return (
    <div class="controls-group">
      <NavBar nav={props.nav} />
      {props.pass && (
        <button title={props.pass.title ?? "Pass"} disabled={props.pass.disabled}
          onClick={props.pass.onClick}>
          <IconPass />
        </button>
      )}
      {props.score && (
        <button title={props.score.title ?? "Estimate score"} disabled={props.score.disabled}
          onClick={props.score.onClick}>
          <IconBalance />
        </button>
      )}
      {props.sgfImport && <SgfImportButton onFileChange={props.sgfImport.onFileChange} />}
      {props.sgfExport && (
        <button title={props.sgfExport.title ?? "Export as SGF file"}
          onClick={props.sgfExport.onClick}>
          <IconFileExport />
        </button>
      )}
      <ToggleButtons coordsToggle={props.coordsToggle} moveConfirmToggle={props.moveConfirmToggle} moveTreeToggle={props.moveTreeToggle} />
    </div>
  );
}

function LiveControls(props: ControlsProps) {
  return (
    <>
      <NavBar nav={props.nav} />
      <div id="action-buttons">
        {props.requestUndo && (
          <button title={props.requestUndo.title ?? "Undo"}
            disabled={props.requestUndo.disabled}
            onClick={props.requestUndo.onClick}>
            <IconUndo />
          </button>
        )}
        {props.pass && !props.confirmPass && (
          <button title={props.pass.title ?? "Pass"} disabled={props.pass.disabled}
            onClick={props.pass.onClick}>
            <IconPass />
          </button>
        )}
        {props.pass && props.confirmPass && (
          <ConfirmButton id="pass-btn" icon={IconPass} title={props.pass.title ?? "Pass"}
            disabled={props.pass.disabled} confirm={props.confirmPass} />
        )}
        {props.resign && (
          <ConfirmButton id="resign-btn" icon={IconWhiteFlag} title="Resign"
            confirm={props.resign} />
        )}
        {props.abort && (
          <ConfirmButton id="abort-btn" icon={() => <>Abort</>} title="Abort game"
            confirm={props.abort} />
        )}
        {props.acceptTerritory && (
          <ConfirmButton id="accept-territory-btn"
            icon={() => <>Accept</>} title="Accept territory"
            disabled={props.acceptTerritory.disabled}
            confirm={props.acceptTerritory} />
        )}
        <span class="btn-group">
          {props.analyze && (
            <button title={props.analyze.title ?? "Analyze"} onClick={props.analyze.onClick}>
              <IconAnalysis />
            </button>
          )}
          {props.estimate && (
            <button title={props.estimate.title ?? "Estimate score"} onClick={props.estimate.onClick}>
              <IconBalance />
            </button>
          )}
          {(props.exitAnalysis || props.exitEstimate) && (
            <button onClick={(props.exitAnalysis ?? props.exitEstimate)!.onClick}>Back to game</button>
          )}
          {props.sgfExport && (
            <button title={props.sgfExport.title ?? "Export SGF"} onClick={props.sgfExport.onClick}>
              <IconFileExport />
            </button>
          )}
          <ToggleButtons coordsToggle={props.coordsToggle} moveConfirmToggle={props.moveConfirmToggle} moveTreeToggle={props.moveTreeToggle} />
        </span>
      </div>
    </>
  );
}

export function Controls(props: ControlsProps) {
  return (
    <>
      {props.layout === "analysis"
        ? <AnalysisControls {...props} />
        : <LiveControls {...props} />}
      {props.confirmMove && (
        <button id="confirm-move-btn" title="Confirm move"
          disabled={props.confirmMove.disabled}
          onClick={props.confirmMove.onClick}>
          <IconCheck />
        </button>
      )}
    </>
  );
}

function SgfImportButton({ onFileChange }: { onFileChange: (input: HTMLInputElement) => void }) {
  return (
    <>
      <button title="Import SGF file" onClick={() => {
        (document.getElementById("sgf-import") as HTMLInputElement)?.click();
      }}>
        <IconFileUpload />
      </button>
      <input type="file" id="sgf-import" accept=".sgf,.SGF" hidden
        onChange={(e) => onFileChange(e.currentTarget as HTMLInputElement)} />
    </>
  );
}

function ToggleButtons({ coordsToggle, moveConfirmToggle, moveTreeToggle }: {
  coordsToggle?: ControlsProps["coordsToggle"];
  moveConfirmToggle?: ControlsProps["moveConfirmToggle"];
  moveTreeToggle?: ControlsProps["moveTreeToggle"];
}) {
  return (
    <>
      {coordsToggle && (
        <button title="Toggle coordinates" onClick={coordsToggle.onClick}>A1</button>
      )}
      {moveConfirmToggle && (
        <button
          title={moveConfirmToggle.enabled
            ? "Move confirmation: ON (click to disable)"
            : "Move confirmation: OFF (click to enable)"}
          onClick={moveConfirmToggle.onClick}>
          {moveConfirmToggle.enabled ? <IconTouchDouble /> : <IconTouchSingle />}
        </button>
      )}
      {moveTreeToggle && (
        <button
          title={moveTreeToggle.enabled
            ? "Hide move tree"
            : "Show move tree"}
          onClick={moveTreeToggle.onClick}>
          <IconGraph />
        </button>
      )}
    </>
  );
}

export function renderControls(el: HTMLElement, props: ControlsProps): void {
  render(<Controls {...props} />, el);
}
