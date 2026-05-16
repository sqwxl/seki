import { localDisconnected } from "../ws";
import { IconOffline } from "./icons";

export function ConnectionStatus() {
  if (!localDisconnected.value) {
    return null;
  }

  return (
    <span class="nav-icon nav-icon-warn" title="Disconnected; reconnecting...">
      <IconOffline />
    </span>
  );
}
