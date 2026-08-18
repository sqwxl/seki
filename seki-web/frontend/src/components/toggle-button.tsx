import classNames from "classnames";
import type { ComponentChildren } from "preact";
import { IconSwitchOff, IconSwitchOn } from "./icons";

type MenuToggleItemProps = {
  on: boolean;
  label: string;
  onToggle: () => void;
};

export function MenuToggleItem({ on, label, onToggle }: MenuToggleItemProps) {
  return (
    <button type="button" class="nav-dropdown-item" onClick={onToggle}>
      {on ? <IconSwitchOn /> : <IconSwitchOff />} {label}
    </button>
  );
}

type ToggleButtonProps = {
  enabled: boolean;
  onToggle: () => void;
  title?: string;
  disabled?: boolean;
  classOn?: string;
  classOff?: string;
  children?: ComponentChildren;
};

export function ToggleButton({
  enabled,
  onToggle,
  title,
  disabled,
  classOn,
  classOff,
  children,
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      class={classNames(enabled && "btn-on", enabled ? classOn : classOff)}
      title={title}
      disabled={disabled}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
