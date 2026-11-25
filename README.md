# HexCreeper

A turn-based swarm game on an infinite grid. You start as a single core piece and grow a swarm of linked pieces, holding off ranked enemy squads while you explore for healing and score. *(Working title, until it has a theme.)*

**▶ Play it here: [maynarddemmon.github.io/HexCreeper](https://maynarddemmon.github.io/HexCreeper/)**

It runs in a desktop browser. It's a work in progress, and games aren't saved between sessions.

## How it plays

- **The swarm is a tree.** Every piece you place links to a neighbour, its parent. Moving a piece carries everything linked below it, so you can shift the whole swarm by moving the core, or reshape it by moving a branch. A piece must stay within 3 steps of its parent. If a piece is destroyed, everything linked below it goes too.
- **Rank** is 1, or 1 + the lower of a piece's two highest-ranked children, so a full binary tree ranks up fastest but is the most fragile. Max HP is 2 × rank. Your highest rank is how many pieces you may move each turn, and your core's rank sets the cost to place a piece or buy a heal (5 × rank).
- **Moving onto an enemy attacks it.** When a group moves, every piece in it that would land on an enemy hits that enemy. Killing *n* enemies in one move scores *n²*, and a kill lets the attacker advance into the empty cell.
- **Enemies come in squads**: link trees with ranks of their own. A squad gets as many actions as its rank and plans its turn piece by piece, so it will carry a piece into reach, strike, and pull back out of reach. Waves grow with your rank, not with time.
- **Quadrants** generate a heal tile and a harm tile each, once, as you approach them. Heal tiles are worth more near unexplored ground; harm tiles hurt the first piece that steps on them, then are gone. Both count down before they appear. Borders between quadrants are often walls (of solid tiles, or sometimes holes) with a narrow door, making chambers. Each quadrant also gets a clump of up to five solid tiles and a clump of up to three holes. Nothing can enter either; solid tiles block sight, holes don't.
- **Fog of war.** You only see enemies within 12 steps of your pieces, and solid tiles block the view. Tiles stay on the map once seen. It can be turned off, or the radius changed, in Settings.

The in-game **Show help** panel has the full rules and controls, and **Settings** has every tunable number.

## Running locally

There's no build step. The game loads its code with a small script loader, so serve it over HTTP rather than opening the file. From the project root:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Linting and tests

The linter and tests need Node.js. Install the dev dependencies once, plus the browser the tests drive:

```
npm install
npx playwright install chromium
```

Then:

```
npm run lint    # ESLint over the game code and the tests
npm test        # Playwright tests in a headless browser
```

The tests start their own static server and load the real `index.html`, then drive the game through `hc.app.game`. Most clear the board first, so they test exactly the pieces and tiles they place. They check that:

- the game starts with no errors or warnings;
- the hex geometry is sound: quadrants tile the plane with no gaps or overlaps, rings and picking are exact;
- the rules behave as intended: ranks, moves per turn, link range, group attacks and combos, advancing after a kill, tiles and their countdowns, heal flow and the paid heal;
- enemy waves follow your rank, squads path around harm, solid and hole tiles, strike and pull back, and don't wait forever;
- fog of war: the vision radius, solid tiles blocking sight (and the edge rule), and seen tiles staying shown;
- saving: a saved game comes back intact on reload, a bad save is cleared and the maps are shown, and the last save can be loaded after losing;
- the UI works: header buttons, help, click versus shift-click, keyboard moves and settings.

### Combat simulator

`npm run sim` plays fights between a hero and enemy groups with the real game code (rules, profiles, action points, squad AI) in headless Chromium, and prints win rate, turns, HP left, damage and hit rates for each challenge tier of a map, or each group you name:

```
npm run sim -- --level 2 --tiers 0,3,5,7 --fights 300
npm run sim -- --groups goblin,goblin_pair --rule "hitChance=50 + 4 * (accuracy - defence)"
```

Options: `--map` (caverns), `--level` (1), `--tiers` or `--groups`, `--fights` (200), `--distance` (4), `--max-turns` (100), `--seed` (1), `--rule name=formula` (repeatable), `--json`. In the browser, open `index.html?dev` and call `hc.simulate({...}, rows => console.table(rows))`. A simple bot plays the hero (it attacks the weakest enemy next to it, else steps toward the nearest), so the numbers are on the hard side; see `js/hc/dev/Simulate.js`.

`npm run setup-hooks` turns on a pre-commit hook that runs the linter and the startup tests. `npx playwright test --headed` shows the browser while they run, and `npx playwright test combat` runs a single file.

## Project layout

| Path | Contents |
|---|---|
| `index.html` | Entry point: colours (light and dark), button styles, locale detection and script loading |
| `js/hc/hc.js` | The `hc` namespace, the tunable numbers, the UI theme and config, and small utilities |
| `js/hc/component/` | Reusable [myt](https://github.com/maynarddemmon/myt) views, taken from TimeCorps: `Misc.js` (layout views, `Panel`, `LabeledValue`), `Btn.js` (`Btn`, `UnderlineBtn`, `SquareBtn`, `ToggleBtn`), `Dialogs.js` (modal, confirm and acknowledge dialogs, and `hc.dialogUtil`) |
| `js/hc/model/` | `Grid.js` (hex geometry), `PieceTypes.js`, `Game.js` (state and rules), `Navigation.js` (routes for Go to and Explore), `Settings.js` (preferences and map rules), `Attrs.js` (declaring and checking them), `Persistence.js` (the save game, in localStorage), `MapComponent.js`, `Generators.js`, `ProximityTileGenerator.js`, `CavernsTileGenerator.js`, `ProximitySpawnGenerator.js`, `EnemyAI.js`, `SquadAI.js` (what makes a map's tiles and enemies and plays the enemies' turn), `Maps.js` (loads `data/init.json5` and map files) |
| `js/hc/view/` | `View.js` (canvas, camera, shared view state), `Render.js` (draws the board), `GameView.js` (the myt view holding the canvas, the info panel and mouse input), `SettingsDialog.js`, `MapsDialog.js` |
| `js/hc/App.js` | The root view: the header bar and its buttons, keyboard input, new games and the help dialog |
| `js/hc/manifest.js` | Which file provides and requires what, for the loader |
| `i18n/` | UI text (`en-US.js`) and myt's own resources |
| `data/help.txt` | The How to Play text, loaded when help opens |
| `data/init.json5`, `data/gamemap/` | The list of maps, and one JSON5 file per map |
| `lib/` | The script loader, myt and JSON5 |
| `fonts/`, `img/` | Space Mono (OFL), the GitHub mark, and in `img/icons/` the [Lucide](https://lucide.dev) icons the UI uses (ISC; only the ones used are copied in, from the `lucide-static` package) |
| `docs/DESIGN.md` | The design notes: every rule, its numbers and the reasoning behind them |
| `docs/PLAYTESTS.md` | The playtest log |
| `tests/` | Playwright tests (`npm test`) and their static server |
| `tools/sim.mjs`, `js/hc/dev/` | The combat simulator (`npm run sim`), loaded in the game only with `?dev` |

### Code conventions

Each file is wrapped as `(pkg => { 'use strict'; … })(hc);` and adds what it provides to the `hc` namespace. `manifest.js` lists those names, so the loader can load files in dependency order. The game itself draws on one canvas for speed; everything around it (header, info panel, dialogs) is myt. All UI text comes from `i18n/en-US.js` via `myt.I18N`. The view files share mutable state (the camera, the hover cell and the current input mode) through `hc.view`.

The game rules only use `hex.dirs` (the neighbour offsets) and `hexDist()` (grid distance), so the hex geometry lives in `model/Grid.js`.

## License

MIT. See [LICENSE](LICENSE).
