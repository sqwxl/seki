# New Game Form Contract

## `GET /api/web/games/new`

The existing endpoint returns `NewGameData`. This contract extends it with variant-specific fields.

### Query Parameters

- `opponent` (string, optional): Pre-selected opponent username for direct challenge.

### Response: `NewGameData` (extended)

```json
{
  "opponent": "player2",
  "user_is_registered": true,
  "rating": {
    "can_create_ranked": true,
    "current_user_rank": {
      "qualifier": "5k",
      "status": "ranked",
      "rating": 1450.0,
      "deviation": 90.0,
      "volatility": 0.06,
      "uncertain": false
    },
    "ranked_unavailable_reason": null
  },
  "eligible_opponents": [
    {
      "id": 2,
      "username": "player2",
      "rank": {
        "qualifier": "3k",
        "status": "ranked",
        "rating": 1560.0,
        "deviation": 80.0,
        "volatility": 0.06,
        "uncertain": false
      }
    }
  ]
}
```

**Field rules**:

- `eligible_opponents`: Array of opponent users. Present when the current user is registered. For rated direct challenges, filtered to exclude users who cannot participate in rating (anonymous, unregistered, non-participating). For unrated direct challenges, includes all users except the current user. Omitted or empty for open-game and email-invite variants.

## `POST /games` (web form submission)

The existing `CreateGameForm` is extended with:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `variant` | `"open"` \| `"challenge"` \| `"email"` | Yes | Determines game creation mode |
| `max_handicap` | integer | No | Only for rated open games (0–9) |
| `invite_message` | string | No | Optional message for email invites |
| `rated` | `"true"` \| absent | No | Checkbox value; absent when unchecked |
| `invite_email` | string | Required if variant=email | Email address |
| `invite_username` | string | Required if variant=challenge | Opponent username |

**Validation rules**:

- If `variant = "email"`: `rated` must not be `"true"` (server rejects).
- If `rated = "true"` and `variant = "open"`: `max_handicap` must be 0–9 inclusive.
- If `rated = "true"` and `variant = "challenge"`: `handicap` and `komi` values from the form are ignored (server derives from ratings).
- If `variant = "email"`: `invite_email` must be a non-empty valid email address.

## `POST /api/games` (API game creation)

The existing `CreateGameParams` struct gains:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `max_handicap` | `Option<i32>` | No | Maximum handicap for rated open games |

Server-side behaviour unchanged: ranked constraints are enforced, manual handicap/komi are rejected or ignored for ranked games.
