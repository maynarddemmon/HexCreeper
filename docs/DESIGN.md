# HexCreeper — design notes

Every rule in the game, its default numbers, and why it is the way it is. All the numbers marked *(setting)* can be changed in the in-game Settings panel.

## Core rules
- World: a **hex grid**, effectively infinite (integer coordinates clamped to ±1,000,000). The core starts at (0,0), the centre of the first quadrant.
- Turn-based. On your turn you may move up to **(highest rank of any of your pieces)** different pieces, each once, in any order. Placing pieces and paid heals are also allowed during the turn and don't use moves. The turn ends with End turn (Enter / `.`), or automatically once no piece can act and you can't afford a placement. Then every enemy squad acts, the turn counter advances, tile countdowns tick (tiles arming under pieces take effect), and enemies may spawn.
- Pieces have a type (which sets how they move), an owner (player or enemy), HP, a score value, a rank and an optional link parent. Both sides use link trees.
- Moving onto an opposing piece is an attack: 1 damage.
- **Advance after a kill** *(setting, on by default)*: if a player attack kills and the whole moving group can then legally step in that direction (every destination cell empty or vacated by the group, link range respected, no active harm tile), the group steps forward as part of the same action, eating any heal tiles it lands on. Otherwise the attackers stay put. Enemies never advance after kills.
- The game is over when your original core is destroyed.

## Grid
- A hex grid: pointy-top hexes in axial coordinates (q, r), 6 neighbours, hex distance (used for link range, spawning and pathing). Link range 3 is a hexagon of 37 cells.
- Quadrants are hexagonal chunks of radius 5 = 91 cells *(setting)*, each with 6 neighbours. Chunks of radius k tile the plane on the lattice (2k+1, −k), (k, k+1), and chunk (0,0) is centred on the start cell.
- Keys: Q E / A D / Z C (NW NE / W E / SW SE), ← / →, numpad 7 9 4 6 1 3.
- History: there was also a square grid (8 neighbours, Chebyshev distance, 5×5 quadrants). After playtesting both, hex "works quite well" and felt better, so as of 2026-11-18 the game is hex only. The chunk radius default went from 2 to 3 along the way, and to 5 with border walls (2026-11-19), for bigger rooms.

## Combos
- **Kills:** killing n enemies in one move scores n × (their total score value), which is n² for 1-point enemies (1, 4, 9, 16…). Enemies destroyed because a piece they were linked below died **count as kills** for the combo.
- **Heals:** eating n heal tiles in one move (a group carried over several tiles) multiplies each tile's value by n.

## Rank (both sides)
- Each piece's rank = max(base, 1 + min(rank of its two highest-ranked children)); a missing child counts as 0. Base = 1. So a piece needs **two** children to rank up, and a full binary tree maximises rank but is the most fragile.
- Player: **max HP = 2 × rank**. When max HP rises, current HP does not *(setting)*: the new capacity has to be healed. When it falls, HP is clamped. **Moves per turn = highest rank among your pieces. Place cost = 5 × core rank.**
- Enemy: **max HP = 1 × rank** *(setting)*. A squad's **actions per turn = its highest rank**.
- Ranks are recomputed whenever a piece is placed, spawned or destroyed.

## Piece types
| Type | Owner | HP | Score value | Movement |
|------|-------|----|-------------|----------|
| core | player | 2 × rank | 1 | 1 cell, any neighbour direction |
| core | enemy  | 1 × rank | 1 | 1 cell, any neighbour direction |

## Actions that cost score
- **Place piece** (P): costs 5 × core rank. Choose an empty cell next to any of your pieces (not an active harm tile), then the neighbouring piece it links to. New pieces start at full HP and can't move until next turn.
- **Heal** (H): costs 5 × core rank, the same as placing. Heals **core rank** HP, starting from a piece you click, and flows along links exactly like a heal tile. **Unused healing is lost.** Only available when some piece is damaged. Doesn't use a move or end the turn.

## The swarm
- Moving a piece moves its whole subtree by the same step. Only the chosen piece spends a move, so pieces it carries can still move themselves afterward. Order matters: reshape the children first, then carry the formation with the parent, or the other way round.
  - Group attack: if any member would step onto an enemy, every such member hits the enemy in front of it (then the advance rule applies).
  - Otherwise every member must land on an empty cell or one vacated by the group.
- Link range: a linked piece must end within 3 steps of its parent *(setting)*. The root is unrestricted.
- When a piece is destroyed, every descendant is destroyed too (both sides).

## Enemy pressure (tied to player rank)
- **R = your highest piece rank.** The turn count doesn't drive difficulty (an optional clock ramp exists, off by default).
- A wave arrives every 3 turns with **base + perRank × (R − 1)** enemies = **1, 3, 5, 7, 9…** at rank 1, 2, 3, 4, 5.
- The wave is split into squads of the **squad cap or one less**, where squad cap = **R + 1** (max 8).
- Losing rank immediately lowers the pressure of later waves.
- 3 single enemies at the start.

## Enemy squads
- Squads are link trees shaped as binary trees (piece i links to piece ⌊(i−1)/2⌋), so a squad of 3 has a rank-2 leader, 7 a rank-3 leader.
- A squad gets **actions = its highest rank** each turn and, like the player, **each piece acts at most once**. Moving a squad piece carries everything linked below it, and group attacks work the same as the player's.
- Killing a squad's leader destroys the whole squad, and every destroyed piece counts toward your kill combo.

## Enemy AI (squad planning)
- **Far squads** (nearest piece more than 6 steps from yours) march: the whole squad steps one cell along the shortest path that avoids harm tiles, keeping its shape.
- **Near squads** plan their turn with a **beam search** (12 plans kept per step) over sequences of single-piece actions, up to their action budget. A plan is scored on:
  - damage dealt: +10 per hit, +15 for hitting the core, +6 per player piece destroyed (including pieces linked below it), +1000 for destroying the core;
  - exposure at the end of the turn: −**caution** (12, *setting*) × (pieces in its subtree) for every squad piece left next to a player piece (×0.6 if it has more than 1 HP);
  - position: +1 for each piece ending exactly 2 steps away (can strike next turn, can't be hit), −0.5 per step for pieces further out.
  - While searching, a partial plan also gets credit for strikes it has set up but not made yet, so "carry into reach → strike → pull back with an ancestor" isn't pruned at its first, bad-looking step.
- **Patience** (2 turns, *setting*): each turn a nearby squad goes without landing a hit, its caution drops (to 0 after 2 idle turns), so it can't hang back at a safe distance forever. A hit resets it. Without patience, cautious squads hovered 2 steps away indefinitely.
- Observed against a wall of player pieces: a leader moves the squad in for a 6-hit group strike, then the mid pieces pull their branches back; or a mid piece strikes and the leader pulls everything back, with idle turns at a safe distance in between. Against a lone, surrounded target there is no safe retreat (any step back carries a piece onto the target, which counts as another attack), so squads keep attacking.

## Quadrants and tiles
- The world is divided into **quadrants** (hexagonal chunks), drawn with lighter grid lines. The start cell is the centre of quadrant (0,0).
- When a player piece is in a quadrant, every quadrant within ⌈vision radius ÷ (3 × quadrant radius + 2)⌉ quadrants of it (at least 1, which it is with the defaults) gets its **solid tiles**, so they exist wherever you could see; this doesn't depend on whether fog of war is on. **Heal and harm tiles** are placed only in that quadrant and its 6 neighbours, so their countdowns are still running when you arrive (placing them further out meant their countdowns had always finished). Each is **once per quadrant**, never cleaned up. Visited quadrants are tinted light blue.
- **Border walls** make chambers: when a quadrant's terrain is made, each of its borders not yet decided becomes a wall with a 50% chance *(setting)*. A wall is tiles on every cell of the quadrant touching that neighbour, except a **door** of 1–2 cells *(settings; 0 makes a solid wall)* in the middle, never at a corner, where walls meet. 25% of walls *(setting)* are holes rather than solid tiles: they block movement but not sight. Each border is decided once, by whichever of its two quadrants is made first, and the wall sits on that quadrant's side; decisions are kept in `Game.borders` (saved). **No quadrant is ever walled in on all six sides:** if a wall with no door would complete that, for either of its quadrants, it gets a door of 1. Random clumps can still block a door. Walls go in first; the random clumps below come after, so holes can replace part of a wall.
- Each quadrant gets **1 heal tile and 1 harm tile** *(settings)* at random empty cells, **0–3 solid tiles** *(settings)* in one connected clump (the first on a random free cell, each next one on a free cell of the quadrant touching the clump), and then **0–3 hole tiles** *(settings)* in a clump the same way. Holes may land on solid tiles and replace them, so they can break up a solid clump.
- Every tile starts with a **countdown** (random 2–8 turns), shown as a number in a dashed outline. It becomes active at 0. **If a piece is standing on it when it activates**, it takes effect at once.
- **Heal tile** (green +): value = ⌊unvisited neighbouring quadrants ÷ 2⌋ + 1. Live; shown as a small number on the tile, so it drops as you explore around it. It heals the piece that ate it first, then flows along links, alternating up (nearest damaged ancestor) and down (most damaged child, or the branch with the most missing HP). Unused healing becomes **1 score** per point.
- **Harm tile** (red ×): 1 damage to a piece that moves onto it or is standing on it when it activates, and then it's **gone**. (It used to stay, and clear once every neighbouring quadrant had been visited; it was what forced the swarm to change shape. Solid tiles do that better now, so as of 2026-11-19 harm tiles are one-shot.)
- Enemies never step onto active harm tiles, and they path around them.
- **Solid tile** (dark grey hex): no piece can ever move onto it or be placed on it, and nothing spawns there; a group can't move if any member would land on one. Solid tiles are there as soon as their quadrant is generated (no countdown) and never go away.
- **Hole tile** (black hex with a dark rim): blocks movement, placing and spawning exactly like a solid tile, but **doesn't block sight**.

## Fog of war
- *(Setting, on by default.)* A cell is **in sight** if it's within the **vision radius** (12 steps, *setting*) of one of your pieces and the straight line between the two cell centres isn't blocked by a solid tile. The two end cells don't count, so you see the solid tiles that block you. A line running exactly along the edge between two cells is blocked only if both are solid.
- **Enemies** (and their links and effects) show only on cells in sight. **Tiles** show once they've been in sight, and after that always show their current state.
- Cells out of sight are dimmed.
- Only you are limited: the enemy AI still sees everything.
- Sight is worked out again only when your pieces' positions, the tiles or the settings change.
- First version, to playtest radius 6 against 12. Possible next steps: markers where enemies were last seen, remembered tiles shown as last seen, denser solid clumps.

## Enemy pathing and spawning
- A distance field is computed each enemy turn (radius 30 around your pieces, avoiding active harm, solid and hole tiles), over the grid's neighbour directions.
- Spawns: a random cell 6–9 steps from the core (a ring on either grid), the squad leader at least 4 steps from every player piece and the rest at least 2; never on a harm, solid or hole tile.

## Settings
Every value applies immediately (those marked "new game" from the next game) and is saved in the browser (`hc.settings`). "Reset to defaults" restores:

| Setting | Default |
|---|---|
| Fog of war | on |
| Vision radius | 12 |
| Spawn a wave every N turns | 3 |
| Enemies per wave at rank 1 | 1 |
| + enemies per wave per rank | 2 |
| Largest squad = rank + | 1 |
| +1 enemy/wave every N turns (0 = off) | 0 |
| Enemies at start | 3 |
| Spawn distance min / max | 6 / 9 |
| Enemy caution (0 = reckless) | 12 |
| Enemy patience (turns) | 2 |
| Enemy HP per rank | 1 |
| Max squad size | 8 |
| Advance after a kill | on |
| Link range | 3 |
| Quadrant radius (new game) | 5 |
| Heal tiles per quadrant | 1 |
| Harm tiles per quadrant | 1 |
| Chance a quadrant border is a wall | 50% |
| Walls made of holes | 25% |
| Door width | 1–2 |
| Solid tiles per quadrant | 0–5 |
| Hole tiles per quadrant | 0–3 |
| Tile countdown min / max (turns) | 2 / 8 |
| Harm tile damage | 1 |
| Base rank | 1 |
| Max HP per rank | 2 |
| Moves per turn per top rank | 1 |
| Place cost per core rank | 5 |
| Heal action cost per core rank | 5 |
| Heal action HP per core rank | 1 |
| Heal tile: base value | 1 |
| Heal +1 per N unvisited quads | 2 |
| Unused heal: score per unit | 1 |
| Rank-up also adds HP | off |

## UI
- Pieces show their rank number. Player pieces are red-orange, and the core has an extra outer ring. Enemies are indigo, with indigo link arrows within squads. HP bars show under pieces with more than 1 max HP. Occupied cells are tinted.
- **Moved this turn:** player pieces that have moved (or were just placed) are drawn **inverted**: a light fill with a coloured ring and number. Pieces that can't move because you're out of moves are faded.
- **Selection:** the selected piece and everything it carries turn **amber**, along with the link arrows between them.
- **Link arrows point from each child to its parent**, so they converge on the core or squad leader. Each is a translucent (50%) trapezoid from the child's cell centre to the parent's, behind the pieces, widening towards the parent. Width grows with the longest chain of pieces below the link, so a lone piece's link starts as a point and widths match where links meet.
- Legal moves are highlighted; attacks in indigo. Hovering a move shows a faint copy of the whole group at its destination, and marks landing cells that are active harm tiles in strong red and active heal tiles in bright green. Hovering an attack highlights every enemy that would be hit.
- **Click** one of your pieces to select it; **shift-click** a cell held by your own piece to move there instead (it falls back to selecting if the move isn't legal).
- **Heal mode** (H): every player piece gets a green ring, thicker if damaged; click one to heal from it.
- A dashed outline shows the link range around the selected piece's parent.
- With fog of war on, cells out of sight are dimmed and enemies there aren't drawn.
- Tiles: active heal = green + with its value; active harm = red × in an inner outline; pending = dashed outline with its countdown; solid = grey filled hex; hole = near-black hex with a dark rim.
- A header bar holds the turn, score, rank and moves left, and every button: End Turn, Place, Heal, Center, Save, Export, Import, New game, Settings, Help and GitHub. Icon buttons (`IconBtn`) show [Lucide](https://lucide.dev) icons copied into `img/icons/` (add one by copying its SVG from the `lucide-static` package), drawn in the button's text colour as a CSS mask; each has a label for screen readers and tests. An info panel at the top left of the board shows core HP and the selected piece.
- Settings live in a dialog: every setting, grouped (numbers as fields, on/off as checkboxes); values outside the allowed range are clamped; only changed values are saved; Reset to Defaults.
- Help (?) is `data/help.txt`, shown in a dialog; it opens by itself on a first visit.
- **Saving**: asks first, then saves the whole game to the browser, replacing any earlier save. Its tooltip says when you last saved. Opening the game carries on from the save if there is one; a save that can't be loaded is cleared with a message. Starting a new game doesn't delete the save, so reloading the page goes back to it. When your core is destroyed and there's a save, the dialog offers **Load Last Save** instead of Close. You can't save a game that's over.
- **Export / Import** (as in TimeCorps): Export downloads the game as it is now as `hexcreeper-save.json`, the same record as the save, written `compact` (one line, as small as possible; the default) or `pretty` (indented) by `hc.cfg.EXPORT_FORMAT`. The record says which in its `format`; either imports, and so does a record with no `format` (older ones). Saves in the browser are always compact. Import asks first, then reads a save file; if it can be used, it replaces the game and is saved, otherwise a dialog says why and nothing changes.

## Balance notes
- See [PLAYTESTS.md](PLAYTESTS.md) for play sessions.
- (Earlier, with both grids.) With the planning AI, a simulated bot that places pieces whenever it can and attacks with every piece that can, but never moves otherwise, lasted a median 11 turns on squares (1 of 10 runs reached the 400-turn cap) and 26 on hexes (none reached it).
- With the old AI, where squads moved as one block, the same bot had 1–2 of 10 runs on squares and 3 of 8 on hexes holding out forever (the **turtling** problem: a stationary rank-4 swarm fed on squads that arrived piecemeal). Patience in the planning AI largely fixes this.
- AI tuning sweep against a wall of pieces over 12 turns: caution 6 → squads brawl (ending exposed 11 of 12 turns); caution 10–15 → a safe strike on 3 turns and exposed on only 3; caution ≥ 9 without patience → squads never commit.
- Heal value rewards exploring, so the explored interior becomes less rewarding; harm tiles you've walked into are gone, but the ones you've avoided stay.
- Advance after a kill favours aggressive play; turn it off to compare.

## Next directions (not built)
- **Levels with goals**, so runs restart now and then and swarms stay manageable (rank ~2–4). Candidate goals: reach a beacon N quadrants away; hunt a boss squad; hold a zone for N turns; or a mix. Open questions: what carries over between levels, and whether maps are procedural with per-level rules or partly hand-designed.
- A real **theme** and name.

## Ideas parked
- Chess-like piece types via `steps()`: leapers (knight), sliders (rook, bishop). Both have hex equivalents (e.g. Gliński's hex chess). Open question: does a slider carry its subtree several cells, or only one?
- Varied enemy types (faster, ranged, different movement).
- Tools to make moving large swarms less tedious.

## Implementation
- `js/hc/hc.js`: the `hc` namespace and tunables (`SPAWN`, `PRESSURE`, `ENEMY`, `AI`, `QUAD`, `TILES`, `HEAL`, `RANK`, `LINK`, `COMBAT`, `OWNERS`, `PIECE_R`), plus small utilities.
- `model/Grid.js`: `makeGrid(k)` returns the `hc.GRID` object for quadrants of radius k: `dirs`, `dist`, `center`, `cellAtWorld`, `corners`, `edges`, `chunkOf` / `chunkKey` / `chunkNeighbours` / `chunkCells`, `ring`, `visibleCells`, `keyDirs`. Also `hexDist()` (= `GRID.dist`) and `euclid2()`. `Game.reset` sets `hc.GRID` from `QUAD.radius`.
- `model/PieceTypes.js`: per-owner `stats`, `steps(piece)` and `draw()`.
- `model/Game.js`: state and rules: `legalMoves`, `act` (combo scoring, advance), `canStep`, `damage`, `moveGroup` → `landOnTiles`, `updateQuadrants` / `generateTerrain` (→ `walledIn`, `placeWall`, `placeClump`) / `generateTiles`, `springHarm`, `tickTiles`, `distanceField`, `waveSize` / `squadCap` / `spawnWave` / `spawnSquad` / `spawnEnemy`, `recomputeRanks`, `maxRank` / `moveLimit` / `placeCost`, `healCost` / `healAmount` / `playerHeal`, `unvisitedAround` / `healValue` / `consumeHeal` → `applyHeal`.
- `model/EnemyAI.js`: `enemyPhase` → `planSquad` (beam search, near squads) / `marchSquad` (far squads), mixed into `Game.prototype`. Squad state: `root.idle`.
- `view/View.js`: `hc.view`, the shared view state (canvas, camera, hover, input mode) and cell-drawing helpers (`cellCenter`, `inView`, `addCellPath`, `fillCell`, `strokeCell`, `strokeRegion`).
- `model/Settings.js`: `hc.settings`, the setting definitions (each maps to a tunable), stored as overrides in localStorage.
- `model/Persistence.js`: `hc.PersistenceManager`, the save game (from TimeCorps). The record `{version, format, savedAt, data}` is stored in localStorage (`hc.save`); `data` is `Game.exportToObj()`, the whole game, and `Game.importFromObj()` restores it. `export` / `importRecord` write and read the same record as a file.
- `view/Render.js` draws the board; `view/GameView.js` is the myt view around the canvas (info panel, status line, mouse input); `view/SettingsDialog.js` builds the settings dialog from the definitions; `App.js` is the myt root view (header, keyboard, new games, help; `hc.app.game` exposes the game for tests).
- UI framework: [myt](https://github.com/maynarddemmon/myt), with components, dialogs, i18n and help loading taken from TimeCorps.
