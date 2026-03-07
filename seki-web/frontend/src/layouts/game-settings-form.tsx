import { render } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";
import { storage, GAME_SETTINGS } from "../utils/storage";
import {
  IconBalance,
  IconNigiri,
  IconGrid4x4,
  IconUndo,
  IconTimer,
  IconBell,
  IconHandicap,
  IconSettings,
  IconPrivate,
  StoneBlack,
  StoneWhite,
} from "../components/icons";
import { UserLabel } from "../components/user-label";

type TimeControl = "none" | "fischer" | "byoyomi" | "correspondence";
type OpponentMode = "open" | "challenge" | "invite";
type OpenTo = "anyone" | "registered";

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
  opponentMode: OpponentMode;
  openTo: OpenTo;
};

type SearchResult = {
  username: string;
  is_registered: boolean;
  is_online: boolean;
  is_recent: boolean;
};

const DEFAULTS: Settings = {
  cols: 19,
  komi: 6.5,
  handicap: 0,
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
  opponentMode: "open",
  openTo: "anyone",
};

function maxHandicap(size: number): number {
  if (size % 2 === 0 || size < 7) {
    return 0;
  }
  return size >= 13 ? 9 : 5;
}

function loadSettings(): Settings {
  try {
    const saved = storage.getJson<Partial<Settings>>(GAME_SETTINGS);
    if (saved) {
      return { ...DEFAULTS, ...saved };
    }
  } catch {}

  return { ...DEFAULTS };
}

type Props = {
  showNotifications?: boolean;
  showPrivate?: boolean;
  submitLabel?: string;
  opponent?: string;
};

export function GameSettingsForm({
  showNotifications = true,
  showPrivate = true,
  submitLabel = "Create Game",
  opponent,
}: Props) {
  const [s, setS] = useState(loadSettings);
  const settingsRef = useRef(s);
  settingsRef.current = s;
  const rootRef = useRef<HTMLDivElement>(null);

  // Local state for challenge search (not persisted)
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentOpponents, setRecentOpponents] = useState<SearchResult[]>([]);
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [recentsFetched, setRecentsFetched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Save to localStorage on form submit
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) {
      return;
    }
    const handler = () => {
      try {
        storage.setJson(GAME_SETTINGS, settingsRef.current);
      } catch {
        // ignore
      }
    };
    form.addEventListener("submit", handler);
    return () => form.removeEventListener("submit", handler);
  }, []);

  // Fetch recent opponents when switching to challenge mode
  useEffect(() => {
    if (s.opponentMode === "challenge" && !recentsFetched) {
      setRecentsFetched(true);
      fetch("/users/search")
        .then((r) => r.json())
        .then((data: SearchResult[]) => setRecentOpponents(data))
        .catch(() => {});
    }
  }, [s.opponentMode, recentsFetched]);

  function doSearch(query: string) {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    fetch(`/users/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data: SearchResult[]) => {
        setSearchResults(data);
      })
      .catch(() => {});
  }

  function onSearchInput(value: string) {
    setSearchQuery(value);
    setSelectedOpponent("");
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (!value) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  }

  const handicapMax = maxHandicap(s.cols);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setS((prev) => {
      const next = { ...prev, [key]: value };
      // Sync handicap when board size changes
      if (key === "cols") {
        const newMax = maxHandicap(value as number);
        if (next.handicap > newMax) {
          next.handicap = newMax;
        }
      }
      return next;
    });
  }

  const tcActive = (tc: string) => s.timeControl === tc;

  const displayResults = searchQuery ? searchResults : recentOpponents;

  const submitText =
    s.opponentMode === "challenge" && selectedOpponent
      ? "Challenge"
      : opponent
        ? "Challenge"
        : submitLabel;

  return (
    <div ref={rootRef}>
      <fieldset>
        <legend>
          <IconSettings /> Settings
        </legend>
        <div>
          <label for="cols">
            <IconGrid4x4 /> Board size
          </label>
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
          <label for="komi">
            <IconBalance /> Komi
          </label>
          <input
            type="number"
            name="komi"
            id="komi"
            min={-100.5}
            max={100.5}
            step={1}
            value={s.komi}
            onChange={(e) =>
              set("komi", parseFloat(e.currentTarget.value) || 0)
            }
          />
        </div>
        <div>
          <label for="handicap">
            <IconHandicap /> Handicap
          </label>
          <select
            name="handicap"
            id="handicap"
            value={s.handicap}
            onChange={(e) =>
              set("handicap", parseInt(e.currentTarget.value, 10))
            }
          >
            <option value={0}>None</option>
            {Array.from({ length: Math.max(0, handicapMax - 1) }, (_, i) => {
              const v = i + 2;
              return (
                <option key={v} value={v}>
                  {v}
                </option>
              );
            })}
          </select>
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
            <label for="color_black" title="Black">
              <StoneBlack />
            </label>
            <input
              type="radio"
              name="color"
              value="white"
              id="color_white"
              checked={s.color === "white"}
              onChange={() => set("color", "white")}
            />
            <label for="color_white" title="White">
              <StoneWhite />
            </label>
            <input
              type="radio"
              name="color"
              value="nigiri"
              id="color_nigiri"
              checked={s.color === "nigiri"}
              onChange={() => set("color", "nigiri")}
            />
            <label for="color_nigiri" title="Random">
              <IconNigiri />
            </label>
          </div>
        </div>
        <div>
          <label for="allow_undo">
            <IconUndo /> Allow takebacks
          </label>
          <input
            type="checkbox"
            name="allow_undo"
            id="allow_undo"
            value="true"
            checked={s.allowUndo}
            onChange={(e) => set("allowUndo", e.currentTarget.checked)}
          />
        </div>
        {showPrivate && (
          <div>
            <label for="is_private">
              <IconPrivate /> Private
            </label>
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
        <legend>
          <IconTimer /> Time control
        </legend>
        <div class="new-game-form-time-controls">
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

      <fieldset>
        <legend>Opponent</legend>
        {opponent ? (
          <div>
            <span>{opponent}</span>
            <input type="hidden" name="invite_username" value={opponent} />
          </div>
        ) : (
          <>
            <div class="opponent-mode-radios">
              <label>
                <input
                  type="radio"
                  name="_opponent_mode"
                  checked={s.opponentMode === "open"}
                  onChange={() => set("opponentMode", "open")}
                />{" "}
                Open
              </label>
              <label>
                <input
                  type="radio"
                  name="_opponent_mode"
                  checked={s.opponentMode === "challenge"}
                  onChange={() => set("opponentMode", "challenge")}
                />{" "}
                Challenge
              </label>
              <label>
                <input
                  type="radio"
                  name="_opponent_mode"
                  checked={s.opponentMode === "invite"}
                  onChange={() => set("opponentMode", "invite")}
                />{" "}
                Invite
              </label>
            </div>

            {s.opponentMode === "open" && (
              <div class="opponent-open-options">
                <label>
                  <input
                    type="radio"
                    name="_open_to"
                    checked={s.openTo === "anyone"}
                    onChange={() => set("openTo", "anyone")}
                  />{" "}
                  Anyone
                </label>
                <label class="disabled-option">
                  <input type="radio" name="_open_to" disabled /> Only friends
                </label>
                <label>
                  <input
                    type="radio"
                    name="_open_to"
                    checked={s.openTo === "registered"}
                    onChange={() => set("openTo", "registered")}
                  />{" "}
                  Only registered
                </label>
                <label class="disabled-option">
                  <input type="radio" name="_open_to" disabled /> Only rated
                </label>
                <input
                  type="hidden"
                  name="open_to"
                  value={s.openTo === "anyone" ? "" : s.openTo}
                />
              </div>
            )}

            {s.opponentMode === "challenge" && (
              <div class="opponent-challenge">
                <input
                  type="text"
                  placeholder="Search by username..."
                  value={searchQuery}
                  onInput={(e) => onSearchInput(e.currentTarget.value)}
                  autocomplete="off"
                />
                {displayResults.length > 0 && (
                  <ul class="opponent-search-results">
                    {displayResults.map((r) => (
                      <li
                        key={r.username}
                        class={
                          selectedOpponent === r.username ? "selected" : ""
                        }
                        onClick={() => {
                          setSelectedOpponent(r.username);
                          setSearchQuery(r.username);
                        }}
                      >
                        <UserLabel
                          name={r.username}
                          isOnline={r.is_online}
                          showRegistered={r.is_registered}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  type="hidden"
                  name="invite_username"
                  value={selectedOpponent}
                />
              </div>
            )}

            {s.opponentMode === "invite" && (
              <div>
                <label for="invite_email">Email address</label>
                <input
                  type="email"
                  name="invite_email"
                  id="invite_email"
                  placeholder="friend@email.com"
                  value={s.inviteEmail}
                  onInput={(e) => set("inviteEmail", e.currentTarget.value)}
                />
              </div>
            )}
          </>
        )}
      </fieldset>

      {showNotifications && !opponent && tcActive("correspondence") && (
        <fieldset>
          <legend>
            <IconBell /> Notifications
          </legend>
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
        </fieldset>
      )}

      <button type="submit">{submitText}</button>
    </div>
  );
}

export function initNewGameForm(root: HTMLElement) {
  const opponent =
    new URLSearchParams(window.location.search).get("opponent") ?? undefined;
  render(<GameSettingsForm opponent={opponent} />, root);
}
