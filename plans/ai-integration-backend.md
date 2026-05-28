# AI Integration — Backend

> Paired with [`ai-integration-frontend.md`](./ai-integration-frontend.md).
> Client and server AI are independent implementations; they don't share code.

## Intent

Add a server-side AI path for authoritative territory estimation, replacing the current heuristic with KataGo. The heuristic remains as a fallback when KataGo is unavailable.

## Components

### Authoritative territory estimation

- When a game ends (both players pass), the server calls KataGo via the existing GTP bridge (`seki-gtp`) to obtain an ownership map.
- KataGo returns ownership and score. Clients use this as the basis for final territory review and negotiation (the existing flow from this point is unchanged).
- For games against bot users (server-side bots, not local), consider skipping territory negotiation altogether and enforcing the server-provided ownership map as-is. This prevents abuse where human players manipulate the final score (bots always auto-approve).
- The existing heuristic in `go-engine/src/territory/` remains as a fallback when the GTP bridge errors or is unavailable.

### Future: game analysis

- The same GTP bridge could serve game analysis requests (winrate graph, variations), following the pattern OGS uses (https://deepwiki.com/online-go/online-go.com/3.7-ai-review-and-analysis-tools).
- This may be infeasible due to cost (significant GPU time). Not part of the initial plan.

## Relationship to existing platform

| Piece | Role |
|---|---|
| `seki-gtp` | Extended to serve authoritative territory estimation. |
| `go-engine/src/territory/` | Remains as fallback when GTP is unavailable. |

New pieces:

| Piece | Purpose |
|---|---|
| GTP territory endpoint/service | Server calls KataGo, stores authoritative ownership/score. |

## Open questions

### Service architecture

Two options for running the GTP service:

- **Same host as web server.** Easier to maintain. The current deployment runs on a Raspberry Pi 3, which is resource-limited and has no dedicated GPU.
- **Dedicated host.** More flexible, can have a GPU. Adds deployment complexity.

### Hardware

Running advanced models at reasonable speed requires a dedicated GPU, which the current deployment (Raspberry Pi 3) lacks. Options:

- **Desktop PC** (AMD Radeon RX 580). Requires the machine to stay running despite being idle most of the time (no active user base yet).
- **Old laptop.** GPU much older, may not perform better. Less power draw than a desktop, survives power outages on battery.
- **Cloud provider.** More compute power, not free, complicates deployment.
- **Dedicated GPU in homelab rack.** More expensive upfront, more control, simpler deployment than cloud.
