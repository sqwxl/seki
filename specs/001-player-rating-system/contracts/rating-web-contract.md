# Web Contract: Player Rating System

This contract describes browser-facing data shape changes for existing SPA JSON routes. Field names are final during task planning but may be adjusted to match existing DTO naming during implementation.

## Shared User Label Data

Any route data that renders a user label may include:

```json
{
  "id": 42,
  "username": "honinbo",
  "rank": {
    "qualifier": "3k",
    "status": "ranked",
    "rating": 1450.0,
    "deviation": 82.0,
    "volatility": 0.06,
    "uncertain": false
  }
}
```

`rating`, `deviation`, and `volatility` are persisted Glicko-2 values. `qualifier` is derived presentation output and should not be treated by the client as a separate source of truth.

Kyu/dan labels are derived by the server from the active rating-to-rank calibration policy. Clients may display returned labels but must not treat them as persisted rating state.

The client uses the global rating display preference to decide which value is primary:

- `kyu_dan`: show `qualifier` as the primary compact value and expose `rating` as the alternate hover/accessibility value
- `rating`: show `rating` as the primary compact value and expose `qualifier` as the alternate hover/accessibility value

When `uncertain` is true, append `?` to the primary displayed rating and to the alternate value when it is a rating/rank value.

Rank status values:

- `anonymous`: no rank qualifier should be rendered
- `not_participating`: render `(-)`
- `unranked`: render `(?)`
- `ranked`: render `(<qualifier>)`, `(<qualifier>?)`, `(<rating>)`, or `(<rating>?)` depending on display preference and uncertainty

## `GET /api/web/games`

Game list items include ranked status, game-bound Glicko-2 snapshots when relevant, derived player rank labels, and automatic ranked settings when visible:

```json
{
  "id": 10,
  "description": "Black vs White",
  "ranked": true,
  "rating_status": "ranked",
  "derived_settings": {
    "handicap": 2,
    "komi": 0.5,
    "color_reason": "lower_rating_black",
    "calibration_policy_version": "provisional-v1"
  },
  "black": {
    "id": 1,
    "username": "black",
    "rank": { "qualifier": "5k", "status": "ranked", "rating": 1420.0, "deviation": 96.0, "volatility": 0.06, "uncertain": false }
  },
  "white": {
    "id": 2,
    "username": "white",
    "rank": { "qualifier": "3k", "status": "ranked", "rating": 1560.0, "deviation": 120.0, "volatility": 0.06, "uncertain": true }
  }
}
```

Unrated games use `ranked: false` and append `(unrated)` in the rendered list description.

## `GET /api/web/games/new`

New-game route data includes whether the current user may create ranked games and enough rating information to explain automatic settings:

```json
{
  "rating": {
    "can_create_ranked": true,
    "current_user_rank": { "qualifier": "5k", "status": "ranked", "rating": 1450.0, "deviation": 90.0, "volatility": 0.06, "uncertain": false },
    "ranked_unavailable_reason": null
  }
}
```

The form submits a ranked choice:

```text
ranked=true|false
```

For ranked games, manual handicap and komi inputs are ignored or disabled in the browser and rejected server-side if submitted. Invalid ranked combinations return the existing structured form error path and do not create a game.

## User Preference Payload

Session bootstrap and preference route data include a rating display preference:

```json
{
  "preferences": {
    "rating_display": "kyu_dan"
  }
}
```

Allowed values:

- `kyu_dan`
- `rating`

Missing or invalid values fall back to `kyu_dan`.

## `GET /api/web/games/:id`

Game route data includes immutable ranked status, game-bound rating snapshots when relevant, automatic ranked settings, and derived rank labels:

```json
{
  "settings": {
    "ranked": true,
    "rating_status": "ranked",
    "handicap": 2,
    "komi": 0.5,
    "color_reason": "lower_rating_black",
    "calibration_policy_version": "provisional-v1"
  },
  "black_rank": { "qualifier": "5k", "status": "ranked", "rating": 1420.0, "deviation": 96.0, "volatility": 0.06, "uncertain": false },
  "white_rank": { "qualifier": "3k", "status": "ranked", "rating": 1560.0, "deviation": 120.0, "volatility": 0.06, "uncertain": true }
}
```

Pre-game ranked contexts always render numeric rating for both players, even when the global rating display preference is `kyu_dan`.

## `GET /api/web/users/:username`

Profile data includes current rating summary and chronological history when visible:

```json
{
  "rating": {
    "participating": true,
    "rating": 1450.0,
    "deviation": 90.0,
    "volatility": 0.06,
    "rank": { "qualifier": "5k", "status": "ranked", "uncertain": false },
    "rated_games": 12,
    "history": [
      {
        "game_id": 10,
        "result": "B+R",
        "rating_before": 1434.0,
        "rating_after": 1450.0,
        "deviation_before": 96.0,
        "deviation_after": 90.0,
        "volatility_before": 0.06,
        "volatility_after": 0.06,
        "rating_delta": 16.0,
        "created_at": "2026-05-15T15:00:00Z"
      }
    ]
  }
}
```

Protected games in history remain hidden unless the current viewer is authorized by existing profile/game visibility rules.

## Realtime Lobby/Game Updates

Existing lobby and game update messages include changed `ranked`, `rating_status`, automatic ranked settings, and user `rank` fields when the visible item changes. Rating updates caused by a completed game should be observable after the game finalization update without requiring a full page reload.
