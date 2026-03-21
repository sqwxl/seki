import { render } from "preact";
import { IconOffline } from "./icons";
import { localDisconnected } from "../ws";

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

export function initConnectionStatus(): void {
  const root = document.getElementById("connection-status");
  if (!root) {
    return;
  }
  render(<ConnectionStatus />, root);
}
