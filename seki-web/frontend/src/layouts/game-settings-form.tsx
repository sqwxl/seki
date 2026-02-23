import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

const STORAGE_KEY = "seki:game_settings";

type TimeControl = "none" | "fischer" | "byoyomi" | "correspondence";

type Settings = {
  cols: number;
  komi: number;
  handicap: number;
  color: string;
  allowUndo: boolean;
  isPrivate: boolean;
  timeControl: TimeControl;
  mainTimeMinutes: number;
  incrementSecs: number;
  byoMainTimeMinutes: number;
  byoyomiTimeSecs: number;
  byoyomiPeriods: number;
  correspondenceDays: number;
  creatorEmail: string;
  inviteEmail: string;
};

const DEFAULTS: Settings = {
  cols: 19,
  komi: 0.5,
  handicap: 1,
  color: "black",
  allowUndo: false,
  isPrivate: false,
  timeControl: "none",
  mainTimeMinutes: 10,
  incrementSecs: 5,
  byoMainTimeMinutes: 20,
  byoyomiTimeSecs: 30,
  byoyomiPeriods: 3,
  correspondenceDays: 3,
  creatorEmail: "",
  inviteEmail: "",
};

function maxHandicap(size: number): number {
  if (size % 2 === 0 || size < 7) {
    return 0;
  }
  return size >= 13 ? 9 : 5;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...DEFAULTS, ...saved };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULTS };
}

// SVG paths (same viewBox 0 -960 960 960)
const filledCirclePath =
  "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z";
const outlineCirclePath =
  "M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z";
const nigiriPath =
  "M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM520-163q119-15 199.5-104.5T800-480q0-123-80.5-212.5T520-797v634Z";

type Props = {
  showNotifications?: boolean;
  showPrivate?: boolean;
  submitLabel?: string;
};

export function GameSettingsForm({
  showNotifications = true,
  showPrivate = true,
  submitLabel = "Create Game",
}: Props) {
  const [s, setS] = useState(loadSettings);
  const settingsRef = useRef(s);
  settingsRef.current = s;
  const rootRef = useRef<HTMLDivElement>(null);

  // Save to localStorage on form submit
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) {
      return;
    }
    const handler = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current));
      } catch {
        // ignore
      }
    };
    form.addEventListener("submit", handler);
    return () => form.removeEventListener("submit", handler);
  }, []);

  const handicapMax = maxHandicap(s.cols);
  const effectiveMax = handicapMax < 2 ? 1 : handicapMax;

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      // Sync handicap when board size changes
      if (key === "cols") {
        const newMax = maxHandicap(value as number);
        const effMax = newMax < 2 ? 1 : newMax;
        if (next.handicap > effMax) {
          next.handicap = effMax;
        }
      }
      return next;
    });
  }

  const tcActive = (tc: string) => s.timeControl === tc;

  return (
    <div ref={rootRef}>
      <fieldset>
        <legend>Settings</legend>
        <div>
          <label for="cols">Board size</label>
          <input
            type="number"
            name="cols"
            id="cols"
            min={5}
            max={19}
            step={2}
            value={s.cols}
            onChange={(e) =>
              set("cols", parseInt(e.currentTarget.value, 10) || 19)
            }
          />
        </div>
        <div>
          <label for="komi">Komi</label>
          <input
            type="number"
            name="komi"
            id="komi"
            min={0.5}
            max={10.5}
            step={0.5}
            value={s.komi}
            onChange={(e) =>
              set("komi", parseFloat(e.currentTarget.value) || 0.5)
            }
          />
        </div>
        <div>
          <label for="handicap">Handicap</label>
          <input
            type="number"
            name="handicap"
            id="handicap"
            min={1}
            max={effectiveMax}
            step={1}
            value={s.handicap}
            onChange={(e) =>
              set("handicap", parseInt(e.currentTarget.value, 10) || 1)
            }
          />
        </div>
        <div>
          <label for="allow_undo">Allow takebacks</label>
          <input
            type="checkbox"
            name="allow_undo"
            id="allow_undo"
            value="true"
            checked={s.allowUndo}
            onChange={(e) => set("allowUndo", e.currentTarget.checked)}
          />
        </div>
        <div>
          <label>Your color</label>
          <div class="color-picker">
            <input
              type="radio"
              name="color"
              value="black"
              id="color_black"
              checked={s.color === "black"}
              onChange={() => set("color", "black")}
            />
            <label for="color_black">
              <svg
                class="icon-stone-black"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 -960 960 960"
              >
                <path d={filledCirclePath} />
              </svg>
            </label>
            <input
              type="radio"
              name="color"
              value="white"
              id="color_white"
              checked={s.color === "white"}
              onChange={() => set("color", "white")}
            />
            <label for="color_white">
              <svg
                class="icon-stone-white"
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 -960 960 960"
              >
                <path d={outlineCirclePath} />
              </svg>
            </label>
            <input
              type="radio"
              name="color"
              value="nigiri"
              id="color_nigiri"
              checked={s.color === "nigiri"}
              onChange={() => set("color", "nigiri")}
            />
            <label for="color_nigiri">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 -960 960 960"
                fill="currentColor"
              >
                <path d={nigiriPath} />
              </svg>
            </label>
          </div>
        </div>
        {showPrivate && (
          <div>
            <label for="is_private">Private?</label>
            <input
              type="checkbox"
              name="is_private"
              id="is_private"
              value="true"
              checked={s.isPrivate}
              onChange={(e) => set("isPrivate", e.currentTarget.checked)}
            />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Time control</legend>
        <div>
          <label>
            <input
              type="radio"
              name="time_control"
              value="none"
              checked={tcActive("none")}
              onChange={() => set("timeControl", "none")}
            />{" "}
            None
          </label>
          <label>
            <input
              type="radio"
              name="time_control"
              value="fischer"
              checked={tcActive("fischer")}
              onChange={() => set("timeControl", "fischer")}
            />{" "}
            Fischer
          </label>
          <label>
            <input
              type="radio"
              name="time_control"
              value="byoyomi"
              checked={tcActive("byoyomi")}
              onChange={() => set("timeControl", "byoyomi")}
            />{" "}
            Byo-yomi
          </label>
          <label>
            <input
              type="radio"
              name="time_control"
              value="correspondence"
              checked={tcActive("correspondence")}
              onChange={() => set("timeControl", "correspondence")}
            />{" "}
            Correspondence
          </label>
        </div>
        <div
          id="tc-fischer"
          style={{ display: tcActive("fischer") ? "" : "none" }}
        >
          <div>
            <label for="main_time_minutes">Main time (minutes)</label>
            <input
              type="number"
              name="main_time_minutes"
              id="main_time_minutes"
              min={1}
              max={180}
              value={s.mainTimeMinutes}
              disabled={!tcActive("fischer")}
              onChange={(e) =>
                set(
                  "mainTimeMinutes",
                  parseInt(e.currentTarget.value, 10) || 10,
                )
              }
            />
          </div>
          <div>
            <label for="increment_secs">Increment (seconds)</label>
            <input
              type="number"
              name="increment_secs"
              id="increment_secs"
              min={0}
              max={60}
              value={s.incrementSecs}
              disabled={!tcActive("fischer")}
              onChange={(e) =>
                set("incrementSecs", parseInt(e.currentTarget.value, 10) || 5)
              }
            />
          </div>
        </div>
        <div
          id="tc-byoyomi"
          style={{ display: tcActive("byoyomi") ? "" : "none" }}
        >
          <div>
            <label for="byo_main_time_minutes">Main time (minutes)</label>
            <input
              type="number"
              name="main_time_minutes"
              id="byo_main_time_minutes"
              min={0}
              max={180}
              value={s.byoMainTimeMinutes}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                set(
                  "byoMainTimeMinutes",
                  parseInt(e.currentTarget.value, 10) || 20,
                )
              }
            />
          </div>
          <div>
            <label for="byoyomi_time_secs">Period time (seconds)</label>
            <input
              type="number"
              name="byoyomi_time_secs"
              id="byoyomi_time_secs"
              min={5}
              max={120}
              value={s.byoyomiTimeSecs}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                set(
                  "byoyomiTimeSecs",
                  parseInt(e.currentTarget.value, 10) || 30,
                )
              }
            />
          </div>
          <div>
            <label for="byoyomi_periods">Periods</label>
            <input
              type="number"
              name="byoyomi_periods"
              id="byoyomi_periods"
              min={1}
              max={10}
              value={s.byoyomiPeriods}
              disabled={!tcActive("byoyomi")}
              onChange={(e) =>
                set("byoyomiPeriods", parseInt(e.currentTarget.value, 10) || 3)
              }
            />
          </div>
        </div>
        <div
          id="tc-correspondence"
          style={{ display: tcActive("correspondence") ? "" : "none" }}
        >
          <div>
            <label for="correspondence_days">Days per move</label>
            <input
              type="number"
              name="correspondence_days"
              id="correspondence_days"
              min={1}
              max={14}
              value={s.correspondenceDays}
              disabled={!tcActive("correspondence")}
              onChange={(e) =>
                set(
                  "correspondenceDays",
                  parseInt(e.currentTarget.value, 10) || 3,
                )
              }
            />
          </div>
        </div>
      </fieldset>

      {showNotifications && (
        <fieldset>
          <legend>Notifications</legend>
          <div>
            <label for="creator_email">
              Get notified when it's your turn to play (optional)
            </label>
            <input
              type="email"
              name="creator_email"
              id="creator_email"
              placeholder="your@email.com"
              value={s.creatorEmail}
              onInput={(e) => set("creatorEmail", e.currentTarget.value)}
            />
          </div>
          <div>
            <label for="invite_email">Invite a friend (optional)</label>
            <input
              type="email"
              name="invite_email"
              id="invite_email"
              placeholder="friend@email.com"
              value={s.inviteEmail}
              onInput={(e) => set("inviteEmail", e.currentTarget.value)}
            />
          </div>
        </fieldset>
      )}

      <button type="submit">{submitLabel}</button>
    </div>
  );
}

export function initNewGameForm(root: HTMLElement) {
  render(<GameSettingsForm />, root);
}
