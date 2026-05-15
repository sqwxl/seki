# API Contract: Player Rating System

This contract describes programmatic API behavior that must hold even when browser clients are bypassed.

## Game Creation

Authenticated registered API clients may request ranked games where allowed:

```json
{
  "cols": 19,
  "rows": 19,
  "komi": 6.5,
  "handicap": 0,
  "ranked": true,
  "is_private": false,
  "open_to": "registered"
}
```

Required behavior:

- Unregistered bearer-token users cannot create ranked games.
- Private games cannot be ranked.
- Ranked games must be open or direct challenges.
- Ranked games cannot be raw invite-only games.
- For ranked games, submitted manual handicap and komi values are rejected or ignored in favor of server-derived settings.
- Server-derived handicap and kyu/dan presentation use the active versioned rating-to-rank calibration policy.
- Invalid ranked combinations return a structured error envelope with a machine-readable code.

## Game Join / Challenge Accept

When a user joins or accepts a ranked game:

- The server verifies the user is registered or a bot.
- The server verifies the user is participating in ranking.
- For open ranked games, the server captures Glicko-2 rating/deviation/volatility snapshots and derives handicap, komi, and color when the second seat is filled.
- Rated game snapshots include the calibration policy version used for derived ranked settings.
- Lower numeric rating receives Black. Exact rating ties use random color assignment.
- Invalid joins return a structured error envelope and do not mutate game seats.

## Game Reads

Public game reads may include ranked status, public numeric ratings, rating deviation-derived uncertainty markers, derived rank labels, and automatic ranked settings for visible public games.

Protected game reads must not reveal rating metadata unless the viewer already has access to the game through existing authorization rules.

Persisted and authoritative API rating values are Glicko-2 rating, deviation, and volatility. Any kyu/dan rank labels returned by API responses are derived presentation fields and must be consistent with the server's active rating-to-rank calibration policy, or the snapshot policy version for game-bound contexts.

## User Profile Reads

User profile responses may include rating summary and rating history for visible games. Rating adjustment rows tied to hidden protected games must be omitted or redacted consistently with existing game-history access rules.

Rating history entries expose rating/deviation/volatility before and after values. Clients that display kyu/dan progression should derive those labels from the numeric rating values or use server-provided derived labels as display-only fields.

Calibration policy changes must not rewrite rating history entries. Historical API responses may include derived labels from the current policy for analysis views, but numeric rating/deviation/volatility remain the stable audit values.

## Result Finalization

Whenever a game reaches a terminal result:

- The server determines whether the game is eligible for rating.
- The server applies Glicko-2 rating adjustments exactly once through `skillratings`.
- The server writes durable rating/deviation/volatility adjustment history for both rated participants.
- Repeated finalization attempts do not create duplicate adjustments.
- Aborted, declined, private, unrated, unplayed, estimate-only, and spectator-only events do not affect ratings.
