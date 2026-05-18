// Email invite variant — always unrated.
// Includes editable settings; recipient details live in the opponent section.

import { BoardSettingsFields } from "./board-parameters";
import {
  AllowUndoField,
  PrivateSpectatorsField,
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
};

export function EmailInviteForm({ s, set }: Props) {
  return (
    <SettingsFieldset>
      <BoardSettingsFields s={s} set={set} colorLabel="Color" maxHandicap={9} />
      <AllowUndoField s={s} set={set} />

      <PrivateSpectatorsField s={s} set={set} />
    </SettingsFieldset>
  );
}
