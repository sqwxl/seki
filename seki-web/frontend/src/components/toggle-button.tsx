import { IconSwitchOff, IconSwitchOn } from "./icons";

type ToggleButtonProps = {
  on: boolean;
  label: string;
  onToggle: () => void;
};

export function ToggleButton({ on, label, onToggle }: ToggleButtonProps) {
  return (
    <button type="button" class="link toggle-btn" onClick={onToggle}>
      {on ? <IconSwitchOn /> : <IconSwitchOff />} {label}
    </button>
  );
}
