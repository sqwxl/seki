// Email invite variant — always unrated
// Rated checkbox disabled and unchecked, email input, optional message

import {
  AllowUndoField,
  EditableBoardSettings,
  PrivateSpectatorsField,
  RankedGameField,
  SettingsFieldset,
  type GameSettingsSetter,
} from "./shared";

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
  set: GameSettingsSetter<EmailInviteSettings>;
  showPrivate?: boolean;
};

export function EmailInviteForm({ s, set, showPrivate = true }: Props) {
  return (
    <SettingsFieldset>
      <RankedGameField
        id="email_ranked"
        checked={false}
        disabled
        help="Email invitation games cannot be rated."
      />

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

      <EditableBoardSettings
        s={s}
        set={set}
        colorLabel="Color"
        maxHandicap={9}
      />
      <AllowUndoField s={s} set={set} />

      {showPrivate && <PrivateSpectatorsField s={s} set={set} />}
    </SettingsFieldset>
  );
}
