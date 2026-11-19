# HexCreeper — playtest log

## 2026-11-17 #1 — endless mode, ranked enemy squads (square grid, 7×7 quadrants, 2 harm per quadrant)
**Result:** reached core rank 5 around turn 100 (rank 5 needs at least 31 pieces in a full binary tree); dropped back to rank 4 around turn 115.

**What happened**
- The rank loss came from losing a few low-rank pieces on the southern edge, where enemies kept pressing in. Losing them broke the binary structure under a high-rank piece.
- Getting health back felt hard.
- A large swarm bogs down: movement nearly stops.
- Harm tiles were the main source of tedium. With 7×7 quadrants and 2 harm tiles each, they were dense enough that moving a big group without stepping on one was hard.
- Rank 6 (at least 63 pieces) would be very hard to manage with that many harm tiles.

**Takeaways**
- Endless "play until you die" gets overwhelming. Proposed: **levels with goals**, so runs restart now and then and swarm size stays manageable.
- Changed afterward: 5×5 quadrants, 1 harm tile per quadrant, the paid Heal action.

## 2026-11-17 #2 — 5×5 quadrants, 1 harm per quadrant, paid heal
**Result:** reached rank 4, died by about turn 100.

**What happened**
- Tighter quadrants made heals easier to get.
- Never got ahead of the enemies.

**Analysis**
- Enemy pressure grew on two axes at once: squads per wave (1 + ⌊turn/30⌋) and squad size (1 + ⌊turn/20⌋), so enemies per wave grew roughly with turn². Around turn 90: 4 squads of 4–5 every 3 turns, about 6 enemies a turn, against 4 moves a turn at rank 4.
- The player's capacity grows only with rank, and each rank costs about twice as many pieces as the last, so a turn-based ramp always overtakes it.
- Changed afterward: enemy pressure tied to player rank; the hex grid option.

## 2026-11-18 #3 — hex grid
**Verdict:** the hex grid "works quite well". Hex chunk radius raised from 2 to 3 (37-cell chunks).
- UI friction: clicking to move onto a cell held by your own piece selected that piece instead. Added shift-click to force the move.
- Multi-piece enemy squads moved as a block and never used independent moves, unlike the player's best tactic (set up an attack, then pull back with an ancestor).

## 2026-11-18 #4 — planning enemy AI (caution 12, patience 2)
**Verdict:** "plays much better": more challenging, and enemies feel less predictable.
- Squads now plan piece by piece: carry into reach, strike, pull back with an ancestor; wait at a safe distance; commit after 2 idle turns.
