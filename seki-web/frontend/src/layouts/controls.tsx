import {
  ControlsProps,
  GameControls,
  NavControls,
  UIControls,
} from "../components/controls";

function AnalysisBoardControls(props: ControlsProps) {
  const reviewing = !!(props.territoryReady || props.territoryExit);

  if (reviewing) {
    return (
      <div class="controls-group">
        <NavControls nav={props.nav} />
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

  return (
    <div class="controls-nav-row">
      <span class="btn-group controls-start">
        <GameControls {...props} />
      </span>
      <span class="btn-group controls-middle">
        <NavControls nav={props.nav} />
      </span>
      <span class="btn-group controls-end">
        <UIControls {...props} />
      </span>
    </div>
  );
}

function LiveGameControls(props: ControlsProps) {
  return (
    <div class="controls-nav-row">
      <span class="btn-group controls-start">
        <GameControls {...props} />
      </span>
      <span class="btn-group controls-middle">
        <NavControls nav={props.nav} />
      </span>
      <span class="btn-group controls-end">
        <UIControls {...props} />
      </span>
    </div>
  );
}

export function Controls(props: ControlsProps) {
  return (
    <>
      {props.layout === "analysis" ? (
        <AnalysisBoardControls {...props} />
      ) : (
        <LiveGameControls {...props} />
      )}
    </>
  );
}
