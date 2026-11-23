(pkg => {
    'use strict';
    
    let appView,
        infoPanel,
        statusTxt,
        gameView,
        
        scoreView,
        movesView,
        turnView,
        endTurnBtn,
        modeBtn,
        pieceMenu,
        saveBtn,
        exportBtn,
        hiddenSaveFileImporter,
        
        persistenceMgr, // The PersistenceManager.
        gameOverShown = false,
        settingsDialog,
        mapsDialog,
        mapBrief,
        
        upDownSide = 0, // which side W and X go first, 0: left (Q, Z), 1: right (E, C); see stepUpDown
        
        nav = null,     // the selected piece going somewhere by itself (see startNav), or null
        navNote = '';   // why it last stopped, shown until you next press a key or click
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PaddedPlainText, PlainText, I18N:{get:i18n}} = M,
        
        {
            view:V,
            Btn, IconBtn, WideView, Spacer, LabeledValue, maps,
            dialogUtil:{openConfirmMsgDialog, openAckMsgDialog, openWhenClear, isAnyShowing},
            theme:{
                spacing, padding,
                colorAccent, colorText, colorTextMuted, colorError, colorHeaderBg, colorHeaderText, colorBtn,
                fontSizeSmall, fontSizeMedium, fontSizeVeryLarge, fontFamilyMono
            },
            cfg:{
                DATA_BASE_DIR, HEADER_HEIGHT, FOOTER_HEIGHT, GITHUB_URL
            },
            ICON_SEPARATOR
        } = pkg,
        
        {game, draw} = V,
        
        I18N_CLOSE_BTN = pkg.ICON_CANCEL + ' ' + i18n('btn-close'),
        GITHUB_MARK_URL = './img/github-mark.svg',
        
        // Help //
        HELP_SEEN_KEY = 'hc.helpSeen',
        hasSeenHelp = () => {
            try {
                return localStorage.getItem(HELP_SEEN_KEY) === 'true';
            } catch {
                return false;
            }
        },
        markHelpSeen = () => {
            try {
                localStorage.setItem(HELP_SEEN_KEY, 'true');
            } catch {
                // Ignore.
            }
        },
        
        /*  The key for a keydown: the code for numpad keys, the lowercase character for
            others, or the key's name (e.g. "Enter"). */
        keyOf = e => e.code.startsWith('Numpad') ? e.code : (e.key.length === 1 ? e.key.toLowerCase() : e.key),
        
        /*  After the game has been replaced by a saved one. */
        afterLoad = () => {
            stopNav('');
            gameOverShown = false;
            V.placeMode = false;
            V.attachMode = false;
            V.swapMode = false;
            V.jumpMode = false;
            V.gotoMode = false;
            V.menuOpen = false;
            centerOn(false);
            draw();
        },
        
        /*  The save button's tooltip says when the game was last saved. */
        updateLastSaved = () => {
            const lastSavedDate = persistenceMgr.getLastSavedDate();
            saveBtn.setTooltip(lastSavedDate ?
                i18n('tip-last-saved', lastSavedDate.toLocaleString(M.I18N.getLocale(), {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})) :
                i18n('tip-not-saved'));
        },
        
        endTurn = () => {
            if (game.over) return;
            V.placeMode = false;
            V.attachMode = false;
            V.swapMode = false;
            V.jumpMode = false;
            V.gotoMode = false;
            V.menuOpen = false;
            game.playerWait();
            gameView.afterTurn();
        },
        
        /*  What the selected piece's menu offers, in its order: place (next to it), swap,
            jump and attach (which then ask for the cell, or the piece to swap with or attach to),
            detach, heal (flowing from it), recover (it), and quicken (the swarm). */
        menuItems = () => {
            const sel = () => game.getSelected(),
                choose = mode => () => {
                    cancelModes();
                    V[mode] = true;
                    draw();
                };
            return [
                {
                    id:'place',
                    label:() => i18n('btn-place', game.placeCost()),
                    tip:() => i18n('tip-place', game.placeCost()),
                    enabled:() => !game.over && game.canAffordPlace() && !!sel() && game.placeCells(sel()).length > 0,
                    run:choose('placeMode')
                },
                {id:'swap', label:() => i18n('btn-swap'), tip:() => i18n('tip-swap'), enabled:() => game.canSwap(sel()), run:choose('swapMode')},
                {id:'jump', label:() => i18n('btn-jump'), tip:() => i18n('tip-jump'), enabled:() => game.canJump(sel()), run:choose('jumpMode')},
                {id:'attach', label:() => i18n('btn-attach'), tip:() => i18n('tip-attach'), enabled:() => game.canAttach(sel()), run:choose('attachMode')},
                {id:'detach', label:() => i18n('btn-detach'), tip:() => i18n('tip-detach'), enabled:() => game.canDetach(sel()), run:() => {
                    if (game.playerDetach(sel())) gameView.afterTurn();
                    draw();
                }},
                {
                    id:'heal',
                    label:() => i18n('btn-heal', game.healAmount(), game.healCost()),
                    tip:() => i18n('tip-heal', game.healCost(), game.healAmount()),
                    enabled:() => !game.over && game.canAffordHeal() && game.anyDamaged(),
                    run:() => {
                        game.playerHeal(sel());
                        draw();
                    }
                },
                {
                    id:'recover',
                    label:() => i18n('btn-recover', sel() ? game.recoverCost(sel()) : 0),
                    tip:() => i18n('tip-recover'),
                    enabled:() => game.canRecover(sel()),
                    run:() => {
                        game.playerRecover(sel());
                        draw();
                    }
                },
                {
                    id:'quicken',
                    label:() => i18n('btn-quicken', game.quickenCost()),
                    tip:() => i18n('tip-quicken', game.quickenCost()),
                    enabled:() => game.canQuicken(),
                    run:() => {
                        game.playerQuicken();
                        draw();
                    }
                },
                {id:'goto', label:() => i18n('btn-goto'), tip:() => i18n('tip-goto'), enabled:() => !game.over && !!sel(), run:choose('gotoMode')},
                {id:'explore', label:() => i18n('btn-explore'), tip:() => i18n('tip-explore'), enabled:() => !game.over && !!sel(), run:() => startNav('explore')}
            ];
        },
        
        // Keys for the menu's items, which act on the selected piece.
        MENU_KEYS = {p:'place', v:'swap', j:'jump', l:'attach', b:'detach', h:'heal', r:'recover', u:'quicken', g:'goto', o:'explore'},
        
        // ---- Go to and Explore ----
        // The selected piece goes somewhere by itself, a step a turn in Follow mode, so the
        // rest of its swarm trails after it (see Navigation.js). After each step the turn
        // ends, and the next step comes once that turn has played (or after a move's time,
        // with animation off). It stops on getting there (Go to), when there's no way on,
        // when one of your pieces is hurt or an enemy comes into view that wasn't in sight
        // the step before, and when you press a key or click.
        
        // The ids of the enemies you can see.
        enemiesInSight = () => {
            const sight = game.cellsInSight();
            return new Set(game.piecesOf('enemy').filter(e => !sight || sight.has(game.key(e.x, e.y))).map(e => e.id));
        },
        
        // Your pieces' HP, by id.
        playerHp = () => new Map(game.piecesOf('player').map(p => [p.id, p.hp])),
        
        /*  Stops going (if it was), saying why: note is an i18n key, or '' for nothing. */
        stopNav = note => {
            if (nav) clearTimeout(nav.timer);
            nav = null;
            navNote = note ? i18n(note) : '';
            draw();
        },
        
        /*  Why going on would stop, after a step or a turn (an i18n key, or '' if it goes
            on): the game's over, one of your pieces was hurt, or an enemy came into view.
            Remembers what's in sight and the HP for next time. */
        navStopReason = () => {
            const enemies = enemiesInSight(),
                hp = playerHp(),
                hurt = [...nav.hp].some(([id, was]) => !hp.has(id) || hp.get(id) < was),
                seen = [...enemies].some(id => !nav.enemies.has(id));
            nav.enemies = enemies;
            nav.hp = hp;
            return game.over ? 'nav-over' : hurt ? 'nav-hurt' : seen ? 'nav-enemy' : '';
        },
        
        // The way on for piece p, going where nav says; and how far it is from each cell.
        navRoute = p => nav.kind === 'goto' ? game.routeTo(p, ...nav.target) : game.exploreRoute(p),
        navField = p => nav.kind === 'goto' ? game.fieldTo(p, ...nav.target) : game.exploreField(p),
        
        /*  Does one of the actions in a plan from planUntangle. Returns whether it did. */
        doPlanned = ({id, kind, x, y, other}) => {
            const q = game.pieces.get(id);
            return kind === 'swap' ? game.playerSwap(q, game.pieces.get(other)) :
                kind === 'jump' ? game.playerJump(q, x, y, true) :
                game.playerAct(q, x, y, kind);
        },
        
        /*  The next step: plans the way from where the piece is now and takes a step along
            it in Follow mode (which tries Fixed, then Free, if it can't follow), ending the
            turn; then waits for that turn to play. If it can't, it untangles its swarm
            (planUntangle), an action at a time, using the moves the turn has, until it can
            step on, keeping off positions the swarm has been in on the way. */
        navStep = () => {
            const p = game.pieces.get(nav.id),
                turn = game.turn;
            let stop = '', did = '';
            if (!p || game.over) {
                stop = game.over ? 'nav-over' : 'nav-lost';
            } else {
                const route = navRoute(p);
                if (!route) {
                    stop = nav.kind === 'goto' ? 'nav-no-route' : 'nav-explored';
                } else {
                    const [x, y] = route[0],
                        move = game.canMove(p) && game.findMove(p, x, y, 'follow');
                    if (move && !move.attack && game.playerAct(p, x, y, 'follow')) {
                        did = 'step';
                    } else {
                        const action = game.planUntangle(p, navField(p), nav.visited)?.[0],
                            q = action && game.pieces.get(action.id);
                        if (!action) {
                            stop = 'nav-blocked';
                        } else if (!game.canMove(q)) {
                            // Its action is in a turn to come.
                            endTurn();
                        } else if (doPlanned(action)) {
                            did = 'untangle';
                        } else {
                            stop = 'nav-blocked';
                        }
                    }
                }
            }
            if (did) {
                gameView.afterTurn();
                nav.visited.add(game.swarmKey(p));
                if (nav.kind === 'goto' && p.x === nav.target[0] && p.y === nav.target[1]) stop = 'nav-arrived';
            }
            // A step ends the turn (if it didn't end by itself, with nothing else to do).
            if (!stop && did === 'step' && game.turn === turn) endTurn();
            stop ||= navStopReason();
            if (stop) {
                stopNav(stop === 'nav-over' ? '' : stop);
            } else {
                const wait = Math.max(game.animationEnd() - performance.now(), pkg.cfg.ANIM.on ? 0 : pkg.cfg.ANIM.MOVE_MS);
                nav.timer = setTimeout(navStep, wait + 20);
            }
        },
        
        /*  The selected piece goes: kind 'goto' (to target, [x, y]) or 'explore' (on toward
            the nearest place you haven't seen, again and again). */
        startNav = (kind, target) => {
            const p = game.getSelected();
            stopNav('');
            cancelModes();
            if (p && !game.over) {
                nav = {kind, target, id:p.id, enemies:enemiesInSight(), hp:playerHp(), timer:null, visited:new Set()};
                navStep();
            }
        },
        
        // The side of the board each move key goes to, for W and X (see stepUpDown).
        SIDE_OF_KEY = {q:0, z:0, Numpad7:0, Numpad1:0, e:1, c:1, Numpad9:1, Numpad3:1},
        
        // Moves (or attacks with) the selected piece by d, [dx, dy]. Returns whether it did.
        stepSelected = d => {
            const sel = game.getSelected();
            let retval = false;
            if (sel && game.playerAct(sel, sel.x + d[0], sel.y + d[1])) {
                gameView.afterTurn();
                retval = true;
            }
            return retval;
        },
        
        /*  W and X: up or down, going to the left (Q or Z) and right (E or C) in turn so
            the swarm heads straight up or down, or to the other side if the next one is
            blocked. Each step, from these keys or the others, makes the other side next, so
            W then X comes back to where it started. */
        stepUpDown = up => {
            const sel = game.getSelected(),
                dirs = up ? [[0, -1], [1, -1]] : [[-1, 1], [0, 1]],
                legal = sel ? game.legalMoves(sel) : [],
                side = [upDownSide, 1 - upDownSide].find(s => legal.some(m => m.dx === dirs[s][0] && m.dy === dirs[s][1]));
            if (side !== undefined && stepSelected(dirs[side])) upDownSide = 1 - side;
        },
        
        cancelModes = () => {
            V.placeMode = false;
            V.attachMode = false;
            V.swapMode = false;
            V.jumpMode = false;
            V.gotoMode = false;
            V.menuOpen = false;
            draw();
        },
        
        // Centres the board on the core, or on the start cell if the core is gone. Animated
        // unless animate is false.
        centerOn = (animate = true) => {
            const p = game.getPlayerCore() ?? {x:0, y:0};
            V.panTo(...pkg.hex.center(p.x, p.y), animate !== false);
        },
        
        INFO_WIDTH = 300,
        
        /*  A goal or penalty as a line of the info panel, with its state: [text, colour].
            Good is a goal met or a penalty avoided; bad and locked can't be put right. */
        objectiveLine = (o, state) => {
            const good = pkg.goals.isGood(o, state),
                status = o.kind === 'goal' ? (good ? 'met' : state.locked ? 'failed' : 'unmet') : (good ? 'avoided' : state.locked ? 'failed' : 'incurred');
            let text = o.kind === 'goal' ? o.name : i18n('objective-penalty', o.name);
            if (!o.required) text = i18n('objective-optional', text);
            if (state.locked) text = i18n('objective-locked', text);
            return [
                i18n('objective-' + o.kind + '-' + status) + ' ' + text,
                good ? colorText : state.locked || o.kind === 'penalty' ? colorError : colorTextMuted
            ];
        },
        
        /*  The stats that don't fit in the header: the map and seed, core HP, the selected
            piece, and the map's goals and penalties with how each stands. */
        InfoPanel = new JSClass('InfoPanel', View, {
            initNode: function(parent, attrs) {
                const self = this;
                attrs.width ??= INFO_WIDTH;
                self.callSuper(parent, attrs);
                
                self.getIDS().pointerEvents = 'none'; // Let clicks go through to the map.
                
                const row = (key, valueColor=colorText) => new LabeledValue(self, {
                    label:i18n(key), fontSize:fontSizeMedium, valueTextColor:valueColor,
                    width:INFO_WIDTH, whiteSpace:'nowrap'
                });
                self.mapInfo = row('info-map');
                self.seed = row('info-seed');
                self.hp = row('info-core-hp', colorAccent);
                const bar = self.hpBar = new View(self, {x:padding, width:INFO_WIDTH - 2*padding, height:6, bgColor:'var(--grid)', roundedCorners:3});
                self.hpFill = new View(bar, {height:6, bgColor:colorAccent, roundedCorners:3});
                self.selected = row('info-selected');
                self.goalsHeader = new PlainText(self, {x:padding, text:i18n('info-goals'), fontSize:fontSizeMedium, textColor:colorTextMuted});
                self.goalRows = [];
                
                new M.SpacedLayout(self, {axis:'y', inset:padding/2, spacing, outset:padding/2, collapseParent:true});
            },
            
            update: function() {
                const self = this,
                    core = game.getPlayerCore(),
                    hp = Math.max(0, core ? core.hp : 0),
                    max = core ? core.maxHp : 1,
                    sel = game.getSelected();
                self.mapInfo.update(game.gameMap?.name ?? i18n('info-none'));
                self.seed.update(game.seed ?? i18n('info-none'));
                self.hp.update(hp + '/' + max);
                self.hpFill.setWidth(self.hpBar.width * hp / max);
                if (sel) {
                    self.selected.update(
                        i18n('info-selected-value', i18n(sel.id === game.playerCoreId ? 'info-core' : sel.parentId ? 'info-linked' : 'info-detached'), sel.rank, sel.hp, sel.maxHp)
                    );
                } else {
                    self.selected.update(i18n('info-none'));
                }
                
                // For each of the map's objectives, its name and state, then in small text
                // its description and progress. Made again when the map changes.
                const list = game.getMapObjectives();
                if (self._rowsFor !== list) {
                    self._rowsFor = list;
                    for (const r of self.goalRows) {
                        r.name.destroy();
                        r.description.destroy();
                        r.progress.destroy();
                    }
                    const textAttrs = {x:padding, width:INFO_WIDTH - 2*padding};
                    self.goalRows = list.map(o => ({
                        name:new PlainText(self, {...textAttrs, fontSize:fontSizeMedium, whiteSpace:'nowrap'}),
                        description:new PlainText(self, {
                            ...textAttrs, x:2*padding, width:INFO_WIDTH - 3*padding, text:o.description, visible:!!o.description,
                            fontSize:fontSizeSmall, textColor:colorTextMuted, whiteSpace:'normal'
                        }),
                        progress:new PlainText(self, {
                            ...textAttrs, x:2*padding, width:INFO_WIDTH - 3*padding, visible:!!o.progress,
                            fontSize:fontSizeSmall, fontFamily:fontFamilyMono, textColor:colorText, whiteSpace:'nowrap'
                        })
                    }));
                    self.goalsHeader.setVisible(list.length > 0);
                }
                list.forEach((o, i) => {
                    const state = game.objectives[i],
                        [text, color] = objectiveLine(o, state),
                        row = self.goalRows[i];
                    row.name.setText(text);
                    row.name.setTextColor(color);
                    row.progress.setText(state.progress);
                });
            }
        });
    
    /*  What gets stored into hc.app. This is myt root view with a header bar across the 
        top and the game below it. Handles the keyboard, the dialogs and setting changes. */
    pkg.App = new JSClass('App', View, {
        include: [M.RootView, M.SizeToWindow],
        
        
        // Life Cycle //////////////////////////////////////////////////////////
        initNode: function(parent, attrs) {
            appView = pkg.app = this;
            
            attrs.minWidth = 360;
            attrs.minHeight = 560;
            
            appView.callSuper(parent, attrs);
            
            // For tests and the console.
            appView.game = game;
            
            appView.buildHdrView(new WideView(appView, {bgColor:colorHeaderBg, height:HEADER_HEIGHT}));
            gameView = appView.gameView = new pkg.GameView(appView, {
                y:HEADER_HEIGHT, 
                percentOfParentWidth:100, percentOfParentHeight:100, 
                percentOfParentHeightOffset:-(HEADER_HEIGHT + FOOTER_HEIGHT)
            }, [M.SizeToParent]);
            appView.buildFtrView(new WideView(appView, {bgColor:colorHeaderBg, height:FOOTER_HEIGHT, valign:'bottom'}));
            
            infoPanel = new InfoPanel(appView, {x:padding, y:HEADER_HEIGHT + padding});
            pieceMenu = new pkg.PieceMenu(gameView, {items:menuItems(), onPick:() => {V.menuOpen = false;}});
            
            statusTxt = new PaddedPlainText(appView, {
                align:'center', valign:'bottom',
                valignOffset:FOOTER_HEIGHT + padding, padding, visible:false,
                textColor:colorText, fontSize:fontSizeMedium
            }, [{
                /*  Updates the overlays, once per frame. */
                update: function() {
                    let status = '';
                    if (V.placeMode) {
                        status = i18n('status-place');
                    } else if (V.attachMode) {
                        status = i18n('status-attach');
                    } else if (V.swapMode) {
                        status = i18n('status-swap');
                    } else if (V.jumpMode) {
                        status = i18n('status-jump');
                    } else if (V.gotoMode) {
                        status = i18n('status-goto');
                    } else if (nav) {
                        status = i18n(nav.kind === 'goto' ? 'status-going' : 'status-exploring');
                    } else if (navNote) {
                        status = navNote;
                    } else if (V.hover) {
                        // A solid under the pointer: what it is and how tough. A hole, or a heal,
                        // harm or loot tile you know of: what it is.
                        const tile = game.tileAt(V.hover.x, V.hover.y),
                            solid = tile?.kind === pkg.TILE_TYPE_SOLID ? pkg.solids.get(tile.subtype) : null,
                            other = tile?.kind === pkg.TILE_TYPE_HOLE ? pkg.holes.get(tile.subtype) : game.isEffectTile(tile) ? game.tileType(tile) : null,
                            known = !game.cellsInSight() || game.seenCells.has(game.key(V.hover.x, V.hover.y));
                        if (known) {
                            if (solid) {
                                status = i18n('status-solid', solid.name, solid.material.name, tile.hp, solid.hp, solid.dr);
                                if (solid.opacity < 100) status += i18n('status-opacity', Math.round(solid.opacity));
                            } else if (other) {
                                status = other.description ? i18n('status-tile', other.name, other.description) : other.name;
                            }
                        }
                    }
                    if (this.text !== status) {
                        this.setText(status);
                        this.sizeViewToDom();
                    }
                    this.setVisible(!!status);
                }
            }]);
            
            // Capture phase: myt's global key handling stops keydown from bubbling.
            window.addEventListener('keydown', appView._keyDown.bind(appView), true);
            window.addEventListener('resize', () => V.resize());
            
            game.reset(); // With the stored settings, now they're in effect.
            
            // Once init.json5 has loaded (it has the materials and solids a game needs), carry on 
            // with the saved game, if there is one, or else show the default map's brief. ready 
            // is true once either is done. Help follows on a first visit.
            const whenReady = () => {
                appView.ready = true;
                if (!hasSeenHelp()) appView.openHelp();
            };
            appView.ready = false;
            persistenceMgr = new pkg.PersistenceManager(game);
            maps.loadIndex(index => {
                if (persistenceMgr.hasSave()) {
                    appView.loadSave();
                    whenReady();
                } else if (index) {
                    appView.briefMap(index.defaultMap, whenReady);
                } else {
                    whenReady();
                }
            });
            updateLastSaved();
            
            V.resize();
            centerOn(false);
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        centerOn,
        
        buildHdrView: hdrView => {
            hdrView.setTextColor(colorHeaderText);
            
            new PlainText(hdrView, {text:i18n('game-title'), fontSize:fontSizeVeryLarge, fontWeight:'bold', fontFamily:fontFamilyMono});
            
            new Spacer(hdrView);
            
            const statAttrs = {textColor:colorHeaderText, valueTextColor:colorBtn};
            turnView = new LabeledValue(hdrView, {label:i18n('lbl-turn'), ...statAttrs});
            scoreView = new LabeledValue(hdrView, {label:i18n('lbl-score'), tooltip:i18n('tip-score'), ...statAttrs});
            
            new Spacer(hdrView);
            
            saveBtn = new IconBtn(hdrView, {icon:'save', label:i18n('lbl-save')}, [{
                doActivated:appView.confirmSave
            }]);
            exportBtn = new IconBtn(hdrView, {icon:'download', label:i18n('lbl-export'), tooltip:i18n('tip-export')}, [{
                doActivated: () => {persistenceMgr.export();}
            }]);
            new IconBtn(hdrView, {icon:'upload', label:i18n('lbl-import'), tooltip:i18n('tip-import')}, [{
                doActivated:appView.confirmImport
            }]);
            new IconBtn(hdrView, {icon:'map', label:i18n('lbl-maps'), tooltip:i18n('tip-maps')}, [{
                doActivated:appView.openMaps
            }]);
            new IconBtn(hdrView, {icon:'rotate-ccw', label:i18n('lbl-new-game'), tooltip:i18n('tip-new-game')}, [{
                doActivated:appView.briefNewGame
            }]);
            
            new PlainText(hdrView, {text:ICON_SEPARATOR});
            
            new IconBtn(hdrView, {icon:'settings', label:i18n('tip-settings'), tooltip:i18n('tip-settings')}, [{
                doActivated:appView.openSettings
            }]);
            new IconBtn(hdrView, {icon:'circle-help', label:i18n('lbl-help'), tooltip:i18n('tip-help')}, [{
                doActivated:appView.openHelp
            }]);
            
            new PlainText(hdrView, {text:ICON_SEPARATOR});
            
            // GitHub's mark, linking to the project in a new tab.
            new IconBtn(hdrView, {iconUrl:GITHUB_MARK_URL, iconSize:20, label:i18n('tip-github'), tooltip:i18n('tip-github')}, [{
                doActivated: () => {window.open(GITHUB_URL, '_blank', 'noopener');}
            }]);
            
            new M.ResizeLayout(hdrView, {inset:padding, spacing:spacing, outset:padding});
            new M.ConstantLayout(hdrView, {targetAttrName:'valign', targetValue:'middle'});
        },
        
        buildFtrView: ftrView => {
            ftrView.setTextColor(colorHeaderText);
            
            new Spacer(ftrView);
            
            const statAttrs = {textColor:colorHeaderText, valueTextColor:colorBtn};
            movesView = new LabeledValue(ftrView, {label:i18n('lbl-moves'), ...statAttrs, paddingRight:padding});
            
            endTurnBtn = new Btn(ftrView, {buttonType:'solid', text:i18n('btn-end-turn'), fontSize:fontSizeMedium, tooltip:i18n('tip-end-turn')}, [{
                doActivated:endTurn
            }]);
            modeBtn = new Btn(ftrView, {text:i18n('btn-mode', i18n('mode-fixed')), fontSize:fontSizeMedium, tooltip:i18n('tip-mode')}, [{
                doActivated: () => {
                    const modes = pkg.MOVE_MODES;
                    game.moveMode = modes[(modes.indexOf(game.moveMode) + 1) % modes.length];
                    draw();
                }
            }]);
            
            new IconBtn(ftrView, {icon:'locate-fixed', label:i18n('lbl-center'), tooltip:i18n('tip-center')}, [{
                doActivated: () => {centerOn();}
            }]);
            
            new Spacer(ftrView);
            
            new M.ResizeLayout(ftrView, {inset:padding, spacing:spacing, outset:padding});
            new M.ConstantLayout(ftrView, {targetAttrName:'valign', targetValue:'middle'});
        },
        
        /*  Called once per frame, as the board is drawn: updates the header and overlays,
            and offers a new game once the core is destroyed. */
        update: () => {
            turnView.update(game.turn);
            scoreView.update(game.score + '/' + game.scoreEarned); // to spend/earned in all
            const gameOver = game.over;
            
            movesView.update(game.movesLeft() + '/' + game.moveLimit());
            
            endTurnBtn.setDisabled(gameOver);
            saveBtn.setDisabled(gameOver);
            exportBtn.setDisabled(gameOver);

            
            modeBtn.setTextAndFit(i18n('btn-mode', i18n('mode-' + game.moveMode)));
            
            // The selected piece's menu, beside it while it's open.
            const sel = game.getSelected();
            if (V.menuOpen && (!sel || gameOver)) V.menuOpen = false;
            pieceMenu.setVisible(V.menuOpen);
            if (V.menuOpen) {
                pieceMenu.refresh();
                pieceMenu.placeNear(...V.cellCenter(sel.x, sel.y), V.cam.size);
            }
            
            
            infoPanel.update();
            statusTxt.update();
            
            if (game.over && !gameOverShown) {
                gameOverShown = true;
                // Use a timeout to give any animations or other gameplay effects a chance to
                // finish (the enemies' moves may still be playing). It's a more appealing UX
                // this way.
                setTimeout(() => {
                    if (game.outcome === 'won') {
                        openConfirmMsgDialog(
                            i18n('dlg-won-title'),
                            i18n('dlg-won-msg', game.gameMap.name, game.turn, game.scoreEarned),
                            () => {appView.briefNewGame();},
                            () => {appView.openMaps();},
                            i18n('btn-play-again'), i18n('btn-maps')
                        );
                    } else {
                        // Lost, to the core being destroyed or to a goal or penalty. With a
                        // save, closing loads it instead.
                        const hasSave = persistenceMgr.hasSave(),
                            by = game.getMapObjectives()[game.lostBy];
                        openConfirmMsgDialog(
                            i18n(by ? 'dlg-lost-title' : 'dlg-game-over-title'),
                            by ? i18n('dlg-lost-' + by.kind + '-msg', by.name, game.scoreEarned, game.turn) : i18n('dlg-game-over-msg', game.scoreEarned, game.turn),
                            () => {appView.briefNewGame();},
                            hasSave ? () => {appView.loadSave();} : null,
                            i18n('btn-play-again'), hasSave ? i18n('btn-load-save') : I18N_CLOSE_BTN
                        );
                    }
                }, 500 + Math.max(0, game.animationEnd() - performance.now()));
            }
        },
        
        /*  A key or a click: stops the selected piece going somewhere by itself, if it is,
            and returns true if so (the key or click does nothing else). Clears why it last
            stopped either way. */
        interrupt: () => {
            const going = !!nav;
            stopNav('');
            return going;
        },
        
        /*  Go to: the selected piece sets off for cell c. */
        goTo: c => {startNav('goto', [c.x, c.y]);},
        
        newGame: () => {
            stopNav('');
            gameOverShown = false;
            V.placeMode = false;
            V.attachMode = false;
            V.swapMode = false;
            V.jumpMode = false;
            V.gotoMode = false;
            V.menuOpen = false;
            game.reset();
            centerOn(false);
        },
        
        /*  Replaces this game with the saved one. If the save can't be used, it's cleared,
            this game carries on, a dialog says why, and then the maps are shown to choose
            one to play instead. */
        loadSave: () => {
            const problem = persistenceMgr.restore();
            if (problem) {
                openAckMsgDialog(i18n('dlg-restore-failed-title'), i18n('dlg-restore-failed-msg', problem));
                updateLastSaved();
                openWhenClear(appView.openMaps);
                return;
            }
            afterLoad();
        },
        
        /*  Asks first, since it replaces the game and the save, then asks for a save file. */
        confirmImport: () => {
            openConfirmMsgDialog(i18n('dlg-import-title'), i18n('dlg-import-msg'), () => {
                hiddenSaveFileImporter ??= new M.HiddenJSONImporter(appView, null, [{
                    processJSON: json => {
                        const problem = persistenceMgr.importRecord(json);
                        updateLastSaved();
                        if (problem) {
                            openAckMsgDialog(i18n('dlg-import-failed-title'), i18n('dlg-import-failed-msg', problem));
                        } else {
                            afterLoad();
                            openAckMsgDialog(i18n('dlg-import-succeeded-title'), i18n('dlg-import-succeeded-msg'));
                        }
                    },
                    handleJSONParsingError: function(err) {
                        this.callSuper(err);
                        openAckMsgDialog(i18n('dlg-import-failed-title'), i18n('dlg-import-not-save-msg'));
                    }
                }]);
                hiddenSaveFileImporter.promptForFile();
            });
        },
        
        /*  Asks first, since it replaces any existing save. */
        confirmSave: () => {
            if (game.over) return;
            openConfirmMsgDialog(i18n('dlg-save-title'), i18n('dlg-save-msg'), () => {
                const saved = persistenceMgr.save();
                updateLastSaved();
                openAckMsgDialog(
                    i18n(saved ? 'dlg-save-succeeded-title' : 'dlg-save-failed-title'),
                    i18n(saved ? 'dlg-save-succeeded-msg' : 'dlg-save-failed-msg')
                );
            });
        },
        
        /*  Loads a map and shows its brief. Start begins a new game in it (with its rules
            and components) with the seed shown; Cancel leaves the game as it is. If the map
            can't be loaded, a dialog says so and the game carries on. callback, if given,
            is called once it's done, whichever way. */
        briefMap: (id, callback) => {
            maps.loadMap(id, gameMap => {
                if (!gameMap) {
                    openAckMsgDialog(i18n('dlg-map-failed-title'), i18n('dlg-map-failed-msg', id));
                    callback?.();
                    return;
                }
                openWhenClear(() => {
                    mapBrief ??= new pkg.MapBrief(appView);
                    mapBrief.show(gameMap, {
                        seed:Number.isInteger(gameMap.seed) ? gameMap.seed : pkg.randomSeed(),
                        underway:!game.over && game.turn > 1,
                        onStart: seed => {
                            const {name, rules, tileGenerator, spawnGenerator, enemyAI, objectives} = gameMap;
                            game.gameMap = {id, name, rules, tileGenerator, spawnGenerator, enemyAI, objectives};
                            game.seed = seed;
                            appView.newGame();
                            callback?.();
                        },
                        onCancel: () => {
                            callback?.();
                        }
                    });
                });
            });
        },
        
        /*  The brief for the map being played, or a new game straight away when there are
            no maps. */
        briefNewGame: () => {
            if (game.gameMap) {
                appView.briefMap(game.gameMap.id);
            } else {
                appView.newGame();
            }
        },
        
        /*  Called when a preference changes, so the game reflects it at once. */
        notifySettingChanged: (_id, _value) => {
            draw();
        },
        
        
        // Opening Dialogs /////////////////////////////////////////////////////
        openMaps: () => {
            mapsDialog ??= new pkg.MapsDialog(appView, {onPlay:id => {appView.briefMap(id);}});
            mapsDialog.show(game.gameMap?.id);
            return mapsDialog;
        },
        
        openSettings: () => {
            settingsDialog ??= new pkg.SettingsDialog(appView);
            settingsDialog.show();
            return settingsDialog;
        },
        
        openHelp: () => {
            pkg.loadTxt(DATA_BASE_DIR + 'help.txt', (success, txt) => {
                if (success) {
                    markHelpSeen();
                    openAckMsgDialog(i18n('dlg-help-title'), txt, null, null, I18N_CLOSE_BTN);
                }
            });
        },
        
        
        // Keyboard ////////////////////////////////////////////////////////////
        /*  Keys that are handled here are stopped (stopPropagation) so a focused button
            doesn't act on them too, except Enter and Space in the open menu, which are for
            its focused item.
            @private */
        _keyDown: function(e) {
            if (e.metaKey || e.ctrlKey || e.altKey || isAnyShowing()) return;
            
            const k = keyOf(e),
                handled = () => {
                    e.preventDefault();
                    e.stopPropagation();
                };
            if (this.interrupt()) {
                handled();
            } else if (k === 's') {
                handled();
                centerOn();
            } else if (!game.over) {
                if (k === 'Escape') {cancelModes(); return;}
                // The selected piece's menu items, by key.
                const item = MENU_KEYS[k] && menuItems().find(it => it.id === MENU_KEYS[k]);
                if (item) {
                    if (item.enabled()) {
                        V.menuOpen = false;
                        item.run();
                    }
                    return;
                }
                if (V.menuOpen) {
                    // The menu: arrows and Tab move between its items.
                    const delta = {ArrowDown:1, ArrowRight:1, ArrowUp:-1, ArrowLeft:-1, Tab:e.shiftKey ? -1 : 1}[k];
                    if (delta) {
                        handled();
                        pieceMenu.moveFocus(delta);
                    }
                    return;
                }
                if (k === 'm') {modeBtn.doActivated(); return;}
                if (k === 'Tab') {
                    e.preventDefault();
                    const mine = game.piecesOf('player');
                    if (!mine.length) return;
                    const i = mine.findIndex(p => p.id === game.selectedId);
                    game.selectedId = mine[(i + (e.shiftKey ? mine.length - 1 : 1)) % mine.length].id;
                    cancelModes();
                    return;
                }
                if (V.placeMode || V.attachMode || V.swapMode || V.jumpMode || V.gotoMode) return;
                if (k === 'Enter') {
                    // Opens the selected piece's menu, its first item focused.
                    if (game.getSelected()) {
                        handled();
                        V.menuOpen = true;
                        this.update(); // shows it now, so it can take the focus
                        pieceMenu.moveFocus(1);
                        draw();
                    }
                } else if (k === ' ' || k === '.' || k === 'Numpad5') {
                    handled();
                    endTurn();
                } else if (k === 'w' || k === 'x' || k === 'Numpad8' || k === 'Numpad2') {
                    handled();
                    stepUpDown(k === 'w' || k === 'Numpad8');
                } else {
                    const d = pkg.hex.keyDirs[k];
                    if (d) {
                        handled();
                        if (stepSelected(d) && k in SIDE_OF_KEY) upDownSide = 1 - SIDE_OF_KEY[k];
                    }
                }
            }
        }
    });
})(hc);
