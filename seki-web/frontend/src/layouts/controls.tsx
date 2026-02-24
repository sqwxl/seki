import {
  ControlsProps,
  GameControls,
  NavControls,
  UIControls,
} from "../components/controls";

export function Controls(props: ControlsProps) {
  const reviewing =
    props.layout === "analysis" &&
    !!(props.territoryReady || props.territoryExit);

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
