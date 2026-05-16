// Email invite variant — always unrated
// Rated checkbox disabled and unchecked, email input, optional message

import {
  IconGrid4x4,
  IconHandicap,
  IconUndo,
  IconPrivate,
  IconBell,
  IconKomi,
  IconNigiri,
  StoneBlack,
  StoneWhite,
  IconSettings,
} from "../../components/icons";

export type EmailInviteSettings = {
  cols: number;
  handicap: number;
  komi: number;
  color: string;
  allowUndo: boolean;
  isPrivate: boolean;
  inviteEmail: string;
  inviteMessage: string;
};

export const EMAIL_DEFAULTS: EmailInviteSettings = {
  cols: 19,
  handicap: 0,
  komi: 6.5,
  color: "black",
  allowUndo: false,
  isPrivate: false,
  inviteEmail: "",
  inviteMessage: "",
};

type Props = {
  s: EmailInviteSettings;
  set: <K extends keyof EmailInviteSettings>(
    key: K,
    value: EmailInviteSettings[K],
  ) => void;
  showPrivate?: boolean;
};

export function EmailInviteForm({ s, set, showPrivate = true }: Props) {
  return (
    <fieldset>
      <legend>
        <IconSettings />
        Settings
      </legend>

      <div>
        <label for="email_ranked">
          <IconBell /> Ranked game
        </label>
        <input
          type="checkbox"
          name="ranked"
          id="email_ranked"
          value="true"
          checked={false}
          disabled
        />
        <p class="form-help">Email invitation games cannot be rated.</p>
      </div>

      <div>
        <label for="invite_email">Email address</label>
        <input
          type="email"
          name="invite_email"
          id="invite_email"
          placeholder="friend@email.com"
          value={s.inviteEmail}
          required
          onInput={(e) => set("inviteEmail", e.currentTarget.value)}
        />
      </div>

      <div>
        <label for="invite_message">Message (optional)</label>
        <textarea
          name="invite_message"
          id="invite_message"
          placeholder="Hey, let's play Go!"
          value={s.inviteMessage}
          onInput={(e) => set("inviteMessage", e.currentTarget.value)}
          rows={3}
        />
      </div>

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
        <label for="handicap">
          <IconHandicap /> Handicap
        </label>
        <select
          name="handicap"
          id="handicap"
          value={s.handicap}
          onChange={(e) => set("handicap", parseInt(e.currentTarget.value, 10))}
        >
          <option value={0}>None</option>
          {Array.from({ length: 8 }, (_, i) => {
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
        <label for="komi">
          <IconKomi /> Komi
        </label>
        <input
          type="number"
          name="komi"
          id="komi"
          min={-100.5}
          max={100.5}
          step={1}
          value={s.komi}
          onChange={(e) => set("komi", parseFloat(e.currentTarget.value) || 0)}
        />
      </div>

      <div>
        <label>Color</label>
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
            <IconPrivate /> Private spectators
          </label>
          <input
            type="checkbox"
            name="is_private"
            id="is_private"
            value="true"
            checked={s.isPrivate}
            onChange={(e) => set("isPrivate", e.currentTarget.checked)}
          />
          <p class="form-help">
            Hide this game from public lists. Non-participants need the invite
            link to view it.
          </p>
        </div>
      )}
    </fieldset>
  );
}
