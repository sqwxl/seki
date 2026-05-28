# Territory Audit — go-engine vs KataGo

Compare the territory estimation pipeline in `go-engine/src/territory/` against the canonical KataGo C++ implementation (`cpp/game/board.cpp`). Identify correctness gaps.

## What to compare

### Dead stone detection

| go-engine | KataGo C++ |
|---|---|
| `dead_stones.rs`: 2-phase (Benson simplified-board + Monte Carlo 100 playouts) | `board.cpp`: Benson's algorithm for pass-alive stones, then iterative region marking with atari/seki detection |
| `alive.rs`: unconditional alive (Benson) | Same algorithm, but also computes pass-alive *territory* and uses it to detect false positives |

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
