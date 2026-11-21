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
- Player: **max HP = 2 × rank**. When max HP rises, current HP does not *(setting)*: the new capacity has to be healed. When it falls, HP is clamped. **Moves per turn = highest rank among your pieces. Place cost = 4 + ⌈your pieces ÷ 2⌉** *(settings)*: it follows how many pieces you have, the core and detached ones included, not rank (2026-11-20; it was 5 × core rank, which detaching to keep ranks low made cheap).
- Enemy: **max HP = 1 × rank** *(setting)*. A squad's **actions per turn = its highest rank**.
- Ranks are recomputed whenever a piece is placed, spawned or destroyed.

## Piece types
| Type | Owner | HP | Score value | Movement |
|------|-------|----|-------------|----------|
| core | player | 2 × rank | 1 | 1 cell, any neighbour direction |
| core | enemy  | 1 × rank | 1 | 1 cell, any neighbour direction |

## Actions that cost score
- **Place piece** (P): costs 4 + ⌈your pieces ÷ 2⌉. From the selected piece's menu (or P): choose an empty cell next to the selected piece (not an active harm tile); the new piece is linked to it (2026-11-21; before, any cell next to any piece, then the piece to link to). New pieces start at full HP and can't move until next turn.
- **Heal** (H): costs 5 × core rank. Heals **core rank** HP, starting from a piece you click, and flows along links exactly like a heal tile. **Unused healing is lost.** Only available when some piece is damaged. Doesn't use a move or end the turn.
- **Recover** (R, 2026-11-20): once a turn, a piece that has moved, or was placed, this turn can move again, for **its rank** in score. It doesn't add a move: moving it again uses one of the turn's moves left (so it's only offered while there's one). Moves used are counted apart from the pieces that moved (`Game.movesUsed`, saved, as is `recoverUsed`), so freeing a piece doesn't give back its move. The turn doesn't end by itself while a Recover could still be used.
- **Quicken** (U, 2026-11-20): once a turn, **one more move** this turn, for the swarm's rank (its highest, which sets the moves a turn) in score. It's done at once (no piece to pick), and adds to `moveLimit()` until the turn ends (`Game.quickenUsed`, saved). With Recover, it lets a piece that has moved go again even when every move was used. The turn doesn't end by itself while Quicken could be used, as with Place.

## The swarm
- **Movement modes** (2026-11-20, `model/Movement.js`): how the pieces linked to a piece move with it. **Fixed**: the whole subtree moves by the same step, keeping its shape (as it always did). **Free**: only the piece moves; a piece below it that would end out of link range is dragged by the same step (and so on down), and if a dragged piece can't move there, neither can the piece. **Follow** (for leading a swarm through tight places): the piece leads and its **whole tree** follows: what's below it, and its parent, grandparent and so on with their other branches (a detached group follows its own top piece). Working out from the lead along links, each piece keeps its place relative to the piece it was reached from; a piece that can't get there takes the best free cell within a step of where it is (staying counts): one keeping its link in range, then nearest that place, then keeping its link closest to its old length, then staying put. Followers treat harm tiles, armed or not, as walls (the lead may step on one). So the swarm flows after its leader around obstacles, e.g. a follower steps into its leader's old cell. In every mode no link may end out of range unless it got shorter. **Attacks:** in Fixed, every piece of the subtree that would land on an enemy (or a solid it can break) hits it; in Free and Follow only the piece itself attacks, and the others go round. You pick the mode for your moves with **Move: …** in the footer (M cycles it); it's saved with the game (`Game.moveMode`), and new games start in the `moveMode` *(setting, Fixed)*. Enemies: a far-off squad marches in Fixed if that gets it closer, else Follow, then Free; near you a squad plans with Fixed and Free only (one result kept where they agree), since Follow would let one piece bring the whole squad in and still leave the leader's group attack, which beat striking and pulling back. `resolveStep(view, id, dx, dy, mode)` holds the rules for player and enemies alike, on a view of the board (`boardView`) or of positions the planner is trying.
- Moving a piece moves its subtree as its mode says (in Fixed, all of it by the same step). Only the chosen piece spends a move, so pieces it carries can still move themselves afterward. Order matters: reshape the children first, then carry the formation with the parent, or the other way round.
  - Group attack (Fixed): if any member would step onto an enemy, every such member hits the enemy in front of it (then the advance rule applies). In Free and Follow only the chosen piece attacks.
  - Otherwise every member must land on an empty cell or one vacated by the group.
- Link range: a linked piece must end within 3 steps of its parent *(setting)*. The root is unrestricted.
- When a piece is destroyed, every descendant is destroyed too (both sides).
- **Swap** (S, 2026-11-21): two pieces of the same side next to each other swap cells (any two, linked or not). Their links stay with them, and nothing else moves; it's allowed only if every link of either ends in range, or got shorter. It uses one move, and both pieces are done for the turn. Each lands on the other's cell's tiles. Enemies can swap too: the planner considers swapping any two squad pieces that haven't acted, though its scoring rarely has a reason to (it doesn't value which piece is where).
- **Detach and attach** (X and L, 2026-11-20): a piece other than the core can be **detached** from its parent, however far apart they are, keeping what's linked below it; a piece with no parent (not the core) can be **attached** to any adjacent piece of yours, in the core's group or another detached one, but not one linked below it (no loops). Either is that piece's action for the turn and uses a move (`useMove`); ranks are recomputed. A detached group acts like any other: it moves and attacks, carrying what's below it, and isn't held by link range. Detached pieces still count for the swarm's rank (the highest rank of any piece), so detaching lowers the moves a turn only when it lowers some piece's rank, e.g. the parent's. Enemies can't detach or attach. Later piece types may not allow either.

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
- **Border walls** make chambers: when a quadrant's terrain is made, each of its borders not yet decided becomes a wall with a 50% chance *(setting)*. A wall is tiles on every cell of the quadrant touching that neighbour, except a **door** of 1–2 cells *(settings; 0 makes a solid wall)* in the middle, never at a corner, where walls meet. 25% of walls *(setting)* are holes rather than solid tiles: they block movement but not sight. Each border is decided from the seed (see Levels) and the border alone, and the wall sits on the side of the quadrant whose key comes first; decisions are kept in `Game.borders` (saved). **No quadrant is ever walled in on all six sides:** if all six of a quadrant's borders would be walls with no door, the first of them (by key) gets a door of 1. Random clumps can still block a door. Walls go in first; the random clumps below come after, so holes can replace part of a wall.
- Each quadrant gets **1 heal tile and 1 harm tile** *(settings)* at random empty cells, **0–3 solid tiles** *(settings)* in one connected clump (the first on a random free cell, each next one on a free cell of the quadrant touching the clump), and then **0–3 hole tiles** *(settings)* in a clump the same way. Holes may land on solid tiles and replace them, so they can break up a solid clump.
- Every tile starts with a **countdown** (random 2–8 turns), shown as a number in a dashed outline. It becomes active at 0. **If a piece is standing on it when it activates**, it takes effect at once.
- **Heal tile** (green +): value = ⌊unvisited neighbouring quadrants ÷ 2⌋ + 1. Live; shown as a small number on the tile, so it drops as you explore around it. It heals the piece that ate it first, then flows along links, alternating up (nearest damaged ancestor) and down (most damaged child, or the branch with the most missing HP). Unused healing becomes **1 score** per point.
- **Loot tile** (gold, a coin, 2026-11-20): a heal tile is a loot tile instead at **10%** *(setting)*. It's active at once (no countdown) and worth **10–30 score** *(settings, rolled from the seed when its quadrant is made, from its own generator so the other tiles don't change, and shown on the tile)*. A player piece that lands on it, or is placed on it, takes it: the score is earned and the tile is gone. Enemies leave it alone.
- **Harm tile** (red ×): 1 damage to a piece that moves onto it or is standing on it when it activates, and then it's **gone**. (It used to stay, and clear once every neighbouring quadrant had been visited; it was what forced the swarm to change shape. Solid tiles do that better now, so as of 2026-11-19 harm tiles are one-shot.)
- Enemies never step onto active harm tiles, and they path around them.
- **Solid tile** (dark grey hex): no piece can move onto it or be placed on it, and nothing spawns there; a group can't move if any member would land on one. Solid tiles are there as soon as their quadrant is generated (no countdown).
- **Solids are made of materials** (2026-11-20, `model/Solids.js`). `data/init.json5` lists `"materials"` (`name`, `hardness`, `density`, `description`; density isn't used yet) and solid subtypes, `"solids"` (`name`, `composition`: a material, `hp`, and optionally `fillColor` and `borderColor`, any CSS colour or a `--variable`, drawn in place of the usual solid grey). A subtype's **DR** is its material's hardness; its HP is its own, since that depends on how much material there is. Walls are made of the `wallSolid` subtype and clumps of `clumpSolid` *(settings, so levels choose them)*; each solid tile keeps its `subtype` and its `hp` (saved). Before init.json5 has loaded there are no subtypes, so the App loads it before any game (a saved one too).
- **Breaking solids:** your pieces (not enemies) can attack a solid like an enemy, by moving into it, but only if their rank is more than its DR. A hit does the attacker's rank less the DR; at 0 HP the solid is gone, leaving open floor, and the attacker advances into it (with `advance` on). In a group move, each piece that would land on a breakable solid hits it. A solid that's too hard just blocks, as before. A damaged solid shows a bar of its HP left, and pointing at a solid says what it is, its material, HP and DR. Solids from saves made before this have no subtype and can't be broken.
- **Hole tile** (near-black hex with lines fading in from its corners): blocks movement, placing and spawning exactly like a solid tile, but **doesn't block sight**.

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

## Levels
- `data/init.json5` lists every level, in order, with what a list of levels needs: `id`, `name`, an optional `number` and a `description`. Its `defaultLevel` is played when there's no saved game. Each level's own file, `data/levels/<id>.json5`, is loaded only when it's played and holds what's needed to play it.
- For now a level file has only `attrs`, keyed by setting id (see Settings below): `{"value":…, "pref":true}`. `value` (optional) is the level's value in place of the default. `pref` (default false) shows the setting in Settings so the player can change it; their changes are kept **per level**. A setting the level doesn't list is at its default and isn't shown, so a level can fix anything, fog of war included. A game remembers its level and those entries, and saves them, so a saved game plays the same even if the level file changes.
- **Endless Play** sets no values and shows every setting, so it plays as the game always has; it has no goals and no end. Levels don't have to be played in order.
- The **Levels** dialog (map button in the header) lists them all; pressing a level's name opens its brief. The info panel shows the level being played and its seed.
- The **level brief** (`view/LevelBrief.js`) comes before every new game: from Levels, New game, Play Again, and on opening HexCreeper with no save (help follows it on a first visit). It shows the level's description, the settings it shows (with the level's values in effect, so they can be set first; the same rows as Settings, `SettingsList`), and a **seed**, filled in with the level's `"seed"` if its file has one, else a random number under a million. A note warns when starting abandons a game under way. Start begins the game with that seed (empty or not a number: a random one); Cancel puts the game's own level values back and it carries on.
- **Seeds** make level generation repeatable: terrain, border walls, tiles and the starting enemies come from `Game.rngFor(...parts)`, a mulberry32 generator seeded from a hash of the seed and the parts (e.g. `'terrain', quadrantKey`), so a quadrant comes out the same whatever order quadrants are made in. Waves, the AI and everything else during play still use `Math.random`. The seed is saved with the game. Not quite everything repeats: tiles skip cells pieces are standing on when the quadrant is made, and settings changed mid-game change what's made afterwards.
- **Goals and penalties** (`model/Goals.js`): a level file may list `"goals"` (things to achieve) and `"penalties"` (things to avoid). Each has a `name`, a `description` and an `expression`, and optionally `progress` (text with expressions in braces, e.g. `"{kills}/40 destroyed"`; numbers that aren't whole show to one decimal place), `lockOnSuccess` (default false: once the expression is true, it stays true and isn't evaluated again), `lockOnFailure` (the same for false) and `required` (default true). They're read into `level.objectives` (`goals.fromLevel`, which refuses the level if one is bad), kept with `game.level` and saved, along with each one's state `{value, locked, progress}` (`Game.objectives`). Progress is worked out with the value, so once an objective locks its progress stays as it was (e.g. "30/30 steps" even if the core goes back).
- They're evaluated (`Game.evaluateObjectives`) when a game starts, after each player action and after each turn. The level is **won** when every required goal is true and every required penalty false; it's **lost** when a required goal is locked false or a required penalty locked true, since it can't be won any more, or when the core is destroyed. Either ends the game (`Game.outcome` 'won' or 'lost', `Game.lostBy` the objective that lost it). Optional ones only show how you're doing. A level with nothing required, like Endless, can't be won. Winning offers Play Again or Levels.
- **Expressions** (`model/Expr.js`) are a small JS-like language, parsed by our own code so an expression from a level or an imported save can reach only what it's given: numbers, `true` / `false`, `+ - * / %`, `< <= > >= == !=` (`===` / `!==` mean the same), `&& || !`, `? :`, parentheses and calls. Values: `turn`, `score`, `scoreEarned`, `coreHp`, `coreMaxHp`, `coreRank`, `coreX`, `coreY`, `coreDist` (steps from 0,0), `pieces`, `maxRank`, `piecesLost`, `piecesPlaced`, `enemies`, `kills`, `quadsVisited`, `lootOpened`. Functions: `dist(x, y)` (the core's steps to a cell), `min`, `max`, `abs`. With the core gone, positions are where it was last. `Game.kills`, `piecesLost` and `piecesPlaced` count pieces destroyed (any way) and placed, and `lootOpened` loot tiles taken; all are saved.
- The brief lists the goals and penalties; the info panel shows each with how it stands: a goal ✓ met, ○ not yet, ✗ failed for good; a penalty ○ avoided, ! incurred, ✗ incurred for good; "(optional)" and "· locked" where they apply. Under it, in small text, come its description and its progress.
- Example levels: *Open Ground* (no walls, few solids, waves every 2 turns; shows vision radius, wave frequency and solids; goal: take the core 30 steps out, optionally destroy 40 enemies; penalty: lose more than 15 pieces) and *The Warrens* (radius-4 quadrants, 90% walls with 1-cell doors, vision 8, fog forced on; shows nothing; goals: visit 12 chambers and last until turn 30; penalty: 30 enemies on the board at once).
- Still to come: more kinds of goals (e.g. places to reach shown on the board), end briefs, going on to the next level, and locking levels.

## Settings
Every setting belongs to the level being played (see Levels): Settings shows only those the level marks `pref`. A change applies immediately (those marked "new game" from the next game) and is saved in the browser per level (`hc.settings`, `{levelId:{settingId:value}}`). "Reset to Defaults" goes back to the level's values. The defaults are:

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
| Chance a heal tile is loot instead | 10% |
| Loot score | 10–30 |
| Chance a quadrant border is a wall | 50% |
| Walls made of holes | 25% |
| Door width | 1–2 |
| Solid tiles per quadrant | 0–5 |
| Hole tiles per quadrant | 0–3 |
| Walls are made of | Stone wall (granite, DR 13, 30 HP) |
| Solid clumps are made of | Boulder (basalt, DR 8, 12 HP) |
| Tile countdown min / max (turns) | 2 / 8 |
| Harm tile damage | 1 |
| Base rank | 1 |
| Max HP per rank | 2 |
| Moves per turn per top rank | 1 |
| Movement mode at the start of a game | Fixed |
| Place cost, base | 4 |
| Place cost: +1 per this many pieces | 2 |
| Heal action cost per core rank | 5 |
| Heal action HP per core rank | 1 |
| Heal tile: base value | 1 |
| Heal +1 per N unvisited quads | 2 |
| Unused heal: score per unit | 1 |
| Rank-up also adds HP | off |

## UI
- Pieces show their rank as a symbol inside the border (`drawRankSymbol` in `PieceTypes.js`): 1 nothing, 2 a vertical line, 3 a triangle (point up), 4 a cross, 5 a solid star, 6 an asterisk (3 lines), 7 a 7-point star, 8 four lines (the compass directions), and 9 and up a star with that many points. Lines run edge to edge. The info panel still gives the number. Player pieces are red-orange. Your core has a thick border and every other piece a thin one. The core is bigger by its border (`CORE_BORDER`), so inside the border it's the same size as other pieces. Selection, heal and link-target rings sit a fixed gap (`RING_GAP`) outside each piece's edge, and the core's HP bar sits lower to clear its ring. Enemies are indigo, with indigo link arrows within squads. HP bars show under pieces with more than 1 max HP. Occupied cells are tinted.
- **Moved this turn:** player pieces that have moved (or were just placed) are drawn **inverted**: a light fill with a coloured ring and number. Pieces that can't move because you're out of moves are faded.
- **Selection:** the selected piece and everything it carries turn **amber**, along with the link arrows between them.
- **Link arrows point from each child to its parent**, so they converge on the core or squad leader. Each is a translucent (50%) trapezoid from the child's cell centre to the parent's, behind the pieces, widening towards the parent. Width grows with the longest chain of pieces below the link, so a lone piece's link starts as a point and widths match where links meet.
- Legal moves are highlighted; attacks in indigo. Hovering a move shows a faint copy of the whole group at its destination, and marks landing cells that are active harm tiles in strong red and active heal tiles in bright green. Hovering an attack highlights every enemy that would be hit.
- **Click** one of your pieces to select it; **shift-click** a cell held by your own piece to move there instead (it falls back to selecting if the move isn't legal).
- **The piece menu** (2026-11-21, `view/PieceMenu.js`): clicking the selected piece again opens a small menu beside it (to its right if there's room, else its left; it follows the piece as the board pans): **Place** (P, next to this piece), **Swap** (S), **Attach** (L), **Detach** (X), **Heal** (H, flowing from this piece), **Recover** (R, this piece) and **Quicken** (U, the swarm), with their costs. Items that can't be used show disabled. Picking one closes it, as does Esc; while it's open, a click anywhere on the board just closes it. The keys work without the menu, on the selected piece. These actions were in the footer, which was getting cluttered.
- **Swap mode** (S): with a piece selected, the pieces it can swap with get a ring; click one to swap.
- **Attach mode** (L): with a piece selected, the pieces it can attach to get a ring; click one to attach it. **Detach** (X) acts at once on the selected piece. The info panel shows a piece with no parent as "Detached".
- A dashed outline shows the link range around the selected piece's parent.
- **Golden path:** a trail of small gold dots (`--path`, 50% opacity; kept small so it doesn't clutter the board) through every cell your core has been on, in order (`Game.corePath`, saved with the game). Each step starts at the centre of its cell and stops a gap short of the next cell's centre, where the next step starts, so steps don't overlap; the last step runs all the way to the core. Each step is drawn separately, so steps you retrace stack up and look darker. It's drawn under the fog, so it dims out of sight like the board.
- With fog of war on, cells out of sight are dimmed and enemies there aren't drawn. Once the game is over, won or lost, every cell you've seen counts as in sight and every enemy is drawn, wherever it is, so you can see what came for you; cells never seen stay in fog.
- Tiles: active heal = green + with its value; active harm = red × in an inner outline; pending = dashed outline with its countdown; solid = grey filled hex; hole = near-black hex with lines from its corners fading towards the centre.
- **Camera:** when your core comes within `EDGE_MARGIN` (100) px of an edge of the board, it pans by whole hexes until the core is clear of it; a core you've dragged off screen is left alone. Recentering (button or Space) and these pans are animated over `PAN_MS` (250 ms); dragging or zooming stops a pan where it is. Starting a game or loading one centres at once.
- A header bar holds the turn, the score as *to spend / earned in all* (`Game.score` / `Game.scoreEarned`; spending only lowers the first, and the game-over message gives the total) and moves left, plus Save, Export, Import, New game, Settings, Help and GitHub. A footer holds moves left, End Turn, the movement mode and Center; the selected piece's actions are in its menu. Icon buttons (`IconBtn`) show [Lucide](https://lucide.dev) icons copied into `img/icons/` (add one by copying its SVG from the `lucide-static` package), drawn in the button's text colour as a CSS mask; each has a label for screen readers and tests. An info panel at the top left of the board shows the level, seed, core HP and the selected piece.
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
- An isometric view (2026-11-20): rows squashed to 60%, the floor a unit thick, solids as raised hex prisms, holes as pits, pieces as upright tokens drawn back to front, clicks on tokens picking their cell. A prototype worked and showed promise, but would need a fair amount of work to feel good to play (readability of distances, solids hiding what's behind them, tuning), so it's set aside.

## Implementation
- `js/hc/hc.js`: the `hc` namespace and tunables (`SPAWN`, `PRESSURE`, `ENEMY`, `AI`, `QUAD`, `TILES`, `HEAL`, `RANK`, `LINK`, `COMBAT`, `OWNERS`, `PIECE_R`), plus small utilities.
- `model/Grid.js`: `makeGrid(k)` returns the `hc.GRID` object for quadrants of radius k: `dirs`, `dist`, `center`, `cellAtWorld`, `corners`, `edges`, `chunkOf` / `chunkKey` / `chunkNeighbours` / `chunkCells`, `ring`, `visibleCells`, `keyDirs`. Also `hexDist()` (= `GRID.dist`) and `euclid2()`. `Game.reset` sets `hc.GRID` from `QUAD.radius`.
- `model/PieceTypes.js`: per-owner `stats`, `steps(piece)` and `draw()`.
- `model/Game.js`: `hc.Game`, a JS.Class (the getters are methods: `getPlayerCore`, `getSelected`); state and rules: `legalMoves`, `act` (combo scoring, advance), `canStep`, `damage`, `moveGroup` → `landOnTiles`, `rngFor`, `updateQuadrants` / `generateTerrain` (→ `borderWall` / `seededBorder`, `placeWall`, `placeClump`) / `generateTiles`, `springHarm`, `tickTiles`, `distanceField`, `waveSize` / `squadCap` / `spawnWave` / `spawnSquad` / `spawnEnemy`, `recomputeRanks`, `maxRank` / `moveLimit` / `placeCost`, `healCost` / `healAmount` / `playerHeal`, `unvisitedAround` / `healValue` / `consumeHeal` → `applyHeal`.
- `model/Solids.js`: `hc.solids` (`define`, `get`, `list`, `getMaterial`), the materials and solid subtypes from init.json5.
- `model/Expr.js`: `hc.expr.compile`, the expression language. `model/Goals.js`: `hc.goals` (`fromLevel`, `compile`, `isGood`, the values and functions) and `hc.Goals`, a JS.Module included in Game: `getLevelObjectives`, `evaluateObjectives` / `endGame`.
- `model/EnemyAI.js`: `enemyPhase` → `planSquad` (beam search, near squads) / `marchSquad` (far squads), in `hc.EnemyAI`, a JS.Module included in Game. Squad state: `root.idle`.
- `view/View.js`: `hc.view`, the shared view state (canvas, camera and its animated pans `panTo` / `stepPan`, hover, input mode) and cell-drawing helpers (`cellCenter`, `inView`, `addCellPath`, `fillCell`, `strokeCell`, `strokeRegion`).
- `model/Settings.js`: `hc.settings`, the setting definitions (each maps to a tunable), stored as overrides in localStorage.
- `model/Persistence.js`: `hc.PersistenceManager`, the save game (from TimeCorps). The record `{version, format, savedAt, data}` is stored in localStorage (`hc.save`); `data` is `Game.exportToObj()`, the whole game, and `Game.importFromObj()` restores it. `export` / `importRecord` write and read the same record as a file.
- `view/Render.js` draws the board; `view/GameView.js` is the myt view around the canvas (info panel, status line, mouse input); `view/SettingsDialog.js` builds the settings rows from the definitions (`SettingsList`) and the dialog around them; `view/LevelsDialog.js` and `view/LevelBrief.js` list levels and brief one; `App.js` is the myt root view (header, keyboard, new games, help; `hc.app.game` exposes the game for tests).
- UI framework: [myt](https://github.com/maynarddemmon/myt), with components, dialogs, i18n and help loading taken from TimeCorps.
