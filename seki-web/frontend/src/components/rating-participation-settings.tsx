import { useState } from "preact/hooks";
import type { UserPreferences } from "../game/types";
import { readUserData } from "../game/util";
import { savePref } from "../utils/preferences";

export function initialRatingParticipation(
  prefs: UserPreferences,
  ratingParticipating?: boolean,
): boolean {
  return ratingParticipating ?? prefs.rating_participating ?? true;
}

export function RatingParticipationSettings({
  ratingParticipating,
}: {
  ratingParticipating?: boolean;
}) {
  const userData = readUserData();
  const prefs = userData?.preferences ?? {};
  const [participating, setParticipating] = useState(
    initialRatingParticipation(prefs, ratingParticipating),
  );

  function toggleParticipation() {
    const next = !participating;

    setParticipating(next);
    savePref("rating_participating", next);
  }

  return (
    <label>
      <input
        type="checkbox"
        checked={participating}
        onChange={toggleParticipation}
      />
      Participate in ranked games?
    </label>
  );
}
