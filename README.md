# HexCreeper

A turn-based swarm game on an infinite grid. You start as a single core piece and grow a swarm of linked pieces, holding off ranked enemy squads while you explore for healing and score. *(Working title, until it has a theme.)*

**▶ Play it here: [maynarddemmon.github.io/HexCreeper](https://maynarddemmon.github.io/HexCreeper/)**

It runs in a desktop browser. It's a work in progress, and games aren't saved between sessions.

## How it plays

- **The swarm is a tree.** Every piece you place links to a neighbour, its parent. Moving a piece carries everything linked below it, so you can shift the whole swarm by moving the core, or reshape it by moving a branch. A piece must stay within 3 steps of its parent. If a piece is destroyed, everything linked below it goes too.
- **Rank** is 1, or 1 + the lower of a piece's two highest-ranked children, so a full binary tree ranks up fastest but is the most fragile. Max HP is 2 × rank. Your highest rank is how many pieces you may move each turn, and your core's rank sets the cost to place a piece or buy a heal (5 × rank).
- **Moving onto an enemy attacks it.** When a group moves, every piece in it that would land on an enemy hits that enemy. Killing *n* enemies in one move scores *n²*, and a kill lets the attacker advance into the empty cell.
- **Enemies come in squads**: link trees with ranks of their own. A squad gets as many actions as its rank and plans its turn piece by piece, so it will carry a piece into reach, strike, and pull back out of reach. Waves grow with your rank, not with time.
- **Quadrants** generate a heal tile and a harm tile each, once, as you approach them. Heal tiles are worth more near unexplored ground; harm tiles hurt anything that steps on them and clear away once the area around them is explored. Both count down before they appear. Each quadrant also gets a clump of up to five solid tiles that nothing can enter.

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
- enemy waves follow your rank, squads path around harm and solid tiles, strike and pull back, and don't wait forever;
- the UI works: header buttons, help, click versus shift-click, keyboard moves and settings.

`npm run setup-hooks` turns on a pre-commit hook that runs the linter and the startup tests. `npx playwright test --headed` shows the browser while they run, and `npx playwright test combat` runs a single file.

## Project layout

| Path | Contents |
|---|---|
| `index.html` | Entry point: colours (light and dark), button styles, locale detection and script loading |
| `js/hc/hc.js` | The `hc` namespace, the tunable numbers, the UI theme and config, and small utilities |
| `js/hc/component/` | Reusable [myt](https://github.com/maynarddemmon/myt) views, taken from TimeCorps: `Misc.js` (layout views, `Panel`, `LabeledValue`), `Btn.js` (`Btn`, `UnderlineBtn`, `SquareBtn`, `ToggleBtn`), `Dialogs.js` (modal, confirm and acknowledge dialogs, and `hc.dialogUtil`) |
| `js/hc/model/` | `Grid.js` (hex geometry), `PieceTypes.js`, `Game.js` (state and rules), `EnemyAI.js` (squad planning), `Settings.js` (every setting, saved to localStorage) |
| `js/hc/view/` | `View.js` (canvas, camera, shared view state), `Render.js` (draws the board), `GameView.js` (the myt view holding the canvas, the info panel and mouse input), `SettingsDialog.js` |
| `js/hc/App.js` | The root view: the header bar and its buttons, keyboard input, new games and the help dialog |
| `js/hc/manifest.js` | Which file provides and requires what, for the loader |
| `i18n/` | UI text (`en-US.js`) and myt's own resources |
| `data/help.txt` | The How to Play text, loaded when help opens |
| `lib/` | The script loader and myt |
| `fonts/`, `img/` | Space Mono (OFL) and the GitHub mark |
| `docs/DESIGN.md` | The design notes: every rule, its numbers and the reasoning behind them |
| `docs/PLAYTESTS.md` | The playtest log |
| `tests/` | Playwright tests (`npm test`) and their static server |

### Code conventions

Each file is wrapped as `(pkg => { 'use strict'; … })(hc);` and adds what it provides to the `hc` namespace. `manifest.js` lists those names, so the loader can load files in dependency order. The game itself draws on one canvas for speed; everything around it (header, info panel, dialogs) is myt. All UI text comes from `i18n/en-US.js` via `myt.I18N`. The view files share mutable state (the camera, the hover cell and the current input mode) through `hc.view`.

The game rules only use `GRID.dirs` (the neighbour offsets) and `hexDist()` (grid distance), so the hex geometry lives in `model/Grid.js`.

## License

MIT. See [LICENSE](LICENSE).
