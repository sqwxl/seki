import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { ToggleButton } from "./toggle-button";
import { readUserData } from "../game/util";
import {
  storage,
  SHOW_COORDINATES,
  SHOW_MOVE_TREE,
  MOVE_CONFIRMATION,
} from "../utils/storage";
import {
  showCoordinates,
  showMoveTree,
  moveConfirmEnabled,
  board,
} from "../game/state";
import { analysisBoard } from "../layouts/analysis-state";
import { themeMode, cycleTheme, getThemeLabel } from "../utils/theme";
import { toggleShowCoordinates } from "../utils/coord-toggle";
import { savePref } from "../utils/preferences";

function ThemeButton() {
  const mode = themeMode.value;
  return (
    <button type="button" class="user-menu-item" onClick={cycleTheme}>
      Theme: {getThemeLabel(mode)}
    </button>
  );
}

function handleCoordsToggle() {
  showCoordinates.value = toggleShowCoordinates();
  savePref("show_coordinates", showCoordinates.value);
  board.value?.setShowCoordinates(showCoordinates.value);
  analysisBoard.value?.setShowCoordinates(showCoordinates.value);
}

function handleMoveConfirmToggle() {
  const next = !moveConfirmEnabled.value;
  moveConfirmEnabled.value = next;
  storage.set(MOVE_CONFIRMATION, String(next));
  savePref("move_confirmation", next);
}

function handleMoveTreeToggle() {
  const next = !showMoveTree.value;
  showMoveTree.value = next;
  storage.set(SHOW_MOVE_TREE, String(next));
  savePref("show_move_tree", next);
  board.value?.render();
  analysisBoard.value?.render();
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const userData = readUserData();
  const username = userData?.display_name ?? "Guest";
  const isRegistered = userData?.is_registered ?? false;

  useEffect(() => {
    if (!open) {
      return;
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", onClickOutside, true);
    return () => document.removeEventListener("click", onClickOutside, true);
  }, [open]);

  return (
    <div class="user-menu" ref={ref}>
      <button
        type="button"
        class="user-menu-trigger"
        onClick={() => setOpen(!open)}
      >
        {username}
      </button>
      {open && (
        <div class="user-menu-dropdown">
          {isRegistered && (
            <div class="user-menu-section">
              <a
                class="user-menu-item"
                href={`/users/${username}`}
                onClick={() => setOpen(false)}
              >
                Profile
              </a>
            </div>
          )}
          <div class="user-menu-section">
            <div class="user-menu-section-label">Settings</div>
            <ThemeButton />
            <div class="user-menu-item">
              <ToggleButton
                on={moveConfirmEnabled.value}
                label="Move confirmation"
                onToggle={handleMoveConfirmToggle}
              />
            </div>
            <div class="user-menu-item">
              <ToggleButton
                on={showCoordinates.value}
                label="Coordinates"
                onToggle={handleCoordsToggle}
              />
            </div>
            <div class="user-menu-item">
              <ToggleButton
                on={showMoveTree.value}
                label="Move tree"
                onToggle={handleMoveTreeToggle}
              />
            </div>
          </div>
          <div class="user-menu-section">
            {isRegistered ? (
              <button
                type="button"
                class="user-menu-item"
                onClick={() => {
                  fetch("/logout", { method: "POST" }).then(() =>
                    location.replace("/"),
                  );
                }}
              >
                Log out
              </button>
            ) : (
              <>
                <a
                  class="user-menu-item"
                  href="/login"
                  onClick={() => setOpen(false)}
                >
                  Log in
                </a>
                <a
                  class="user-menu-item"
                  href="/register"
                  onClick={() => setOpen(false)}
                >
                  Register
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function initUserMenu(): void {
  const root = document.getElementById("user-menu");
  if (!root) {
    return;
  }
  render(<UserMenu />, root);
}
