import {
  ControlsProps,
  GameControls,
  NavControls,
  UIControls,
} from "../components/controls";
import { IconCheck } from "../components/icons";

export function Controls(props: ControlsProps) {
  const reviewing = props.layout === "analysis-review";

  if (reviewing) {
    const reviewOverride = props.territoryReady
      ? {
          onClick: props.territoryReady.onClick,
          disabled: props.territoryReady.disabled,
          title: "Accept territory",
          content: <IconCheck />,
        }
      : undefined;

    return (
      <div class="controls-group">
        <NavControls nav={props.nav} counterOverride={reviewOverride} />
        {props.territoryExit && (
          <button onClick={props.territoryExit.onClick}>Exit</button>
        )}
      </div>
    );
  }

  const counterOverride = props.confirmMove
    ? {
        onClick: props.confirmMove.onClick,
        disabled: props.confirmMove.disabled,
        title: "Confirm move",
        content: <IconCheck />,
      }
    : props.acceptTerritory
      ? {
          onClick: props.acceptTerritory.onClick,
          disabled: props.acceptTerritory.disabled,
          title: "Accept territory",
          content: <IconCheck />,
        }
      : undefined;

  return (
    <div class="controls-row">
      <span class="btn-group controls-start">
        <GameControls {...props} />
      </span>
      <span class="btn-group controls-middle">
        <NavControls nav={props.nav} counterOverride={counterOverride} />
      </span>
      <span class="btn-group controls-end">
        <UIControls {...props} />
      </span>
    </div>
  );
}
