# Territory Audit — go-engine vs KataGo

Compare the territory estimation pipeline in `go-engine/src/territory/` against the canonical KataGo C++ implementation (`cpp/game/board.cpp`). Identify correctness gaps.

Current status: a first KataGo-style pass-alive area port now exists in
`go-engine/src/territory/pass_alive.rs`, including area calculation and
independent-life/seki region filtering. MCTS value blending can use this
deterministic area score. The older Japanese dead-stone detector remains in
`dead_stones.rs` because frontend/WASM scoring still needs an explicit
dead-stone list.

## What to compare

### Dead stone detection

| go-engine | KataGo C++ |
|---|---|
| `dead_stones.rs`: 2-phase (Benson simplified-board + Monte Carlo 100 playouts) | `board.cpp`: Benson's algorithm for pass-alive stones, then iterative region marking with atari/seki detection |
| `alive.rs`: unconditional alive (Benson) | Same algorithm, but also computes pass-alive *territory* and uses it to detect false positives |
| `pass_alive.rs`: KataGo-style pass-alive area and independent-life area port | `board.cpp`: `calculateAreaForPla` / `calculateIndependentLifeArea` |

Key questions:
- Does our simplified-board Benson phase produce false positives (marking dead stones as alive)?
- Does our Monte Carlo phase miss seki?
- KataGo has a dedicated seki detection pass. We have none. What cases break?

### Territory counting

| go-engine | KataGo C++ |
|---|---|
| `scoring.rs`: flood-fill from empty points, assign to bordering color | `board.cpp`: pass-alive territory marking, then region walking with atari/dame checks to strip seki |

Key questions:
- Our flood-fill assigns territory when only one color borders. KataGo further restricts this based on pass-alive status. Where does this diverge?
- KataGo strips "seki-touching basic areas." What does this catch that we don't?

### Scoring

| go-engine | KataGo C++ |
|---|---|
| Japanese-style: territory + captures + dead stones + komi | Supports Japanese and Chinese. Territory scoring with ruleset-specific adjustments |

## Deliverable

A short document in `plans/territory-audit.md` covering:
- Algorithm-level differences between the two implementations
- Specific board positions where our code produces incorrect results (false dead/alive, wrong territory assignment, missed seki)
- Severity: how common are these positions in real games?
- Recommended fixes, if any

## Current follow-ups

- Expose pass-alive/independent-life area through WASM for frontend diagnostics.
- Decide how to combine pass-alive area with the Japanese dead-stone detector
  without conflating area ownership with dead-stone review state.
- Add fixture comparisons for the screenshot-derived bot positions against:
  model ownership, old detector dead stones, Japanese score, and pass-alive area.
