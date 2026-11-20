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
        placeBtn,
        healBtn,
        saveBtn,
        exportBtn,
        hiddenSaveFileImporter,
        
        persistenceMgr, // The PersistenceManager.
        gameOverShown = false,
        settingsDialog,
        levelsDialog,
        levelBrief;
    
    const JSClass = JS.Class,
        
        M = myt,
        {View, PaddedPlainText, PlainText, I18N:{get:i18n}} = M,
        
        {
            view:V,
            Btn, ToggleBtn, IconBtn, WideView, Spacer, LabeledValue, levels, settings,
            dialogUtil:{openConfirmMsgDialog, openAckMsgDialog, openWhenClear, isAnyShowing},
            theme:{
                spacing, padding,
                colorAccent, colorText, colorHeaderBg, colorHeaderText, colorBtn, 
                fontSizeMedium, fontSizeVeryLarge, fontFamilyMono
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
            // The level's values, as they were when the game was saved.
            settings.applyLevel(game.level?.id, game.level?.attrs);
            gameOverShown = false;
            V.placeMode = null;
            V.healMode = false;
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
            V.placeMode = null;
            V.healMode = false;
            game.playerWait();
            gameView.afterTurn();
        },
        
        cancelModes = () => {
            V.placeMode = null;
            V.healMode = false;
            draw();
        },
        
        // Centres the board on the core, or on the start cell if the core is gone. Animated
        // unless animate is false.
        centerOn = (animate = true) => {
            const p = game.playerCore ?? {x:0, y:0};
            V.panTo(...pkg.GRID.center(p.x, p.y), animate !== false);
        },
        
        INFO_WIDTH = 300,
        
        /*  The stats that don't fit in the header: core HP, turn, piece counts, the next wave
            and the selected piece. */
        InfoPanel = new JSClass('InfoPanel', View, {
            initNode: function(parent, attrs) {
                const self = this;
                attrs.width ??= INFO_WIDTH;
                self.callSuper(parent, attrs);
                
                const row = (key, valueColor=colorText) => new LabeledValue(self, {
                    label:i18n(key), fontSize:fontSizeMedium, valueTextColor:valueColor,
                    width:INFO_WIDTH, whiteSpace:'nowrap'
                });
                self.level = row('info-level');
                self.seed = row('info-seed');
                self.hp = row('info-core-hp', colorAccent);
                const bar = self.hpBar = new View(self, {x:padding, width:INFO_WIDTH - 2*padding, height:6, bgColor:'var(--grid)', roundedCorners:3});
                self.hpFill = new View(bar, {height:6, bgColor:colorAccent, roundedCorners:3});
                self.selected = row('info-selected');
                
                new M.SpacedLayout(self, {axis:'y', inset:padding/2, spacing, outset:padding/2, collapseParent:true});
            },
            
            update: function() {
                const self = this,
                    core = game.playerCore,
                    hp = Math.max(0, core ? core.hp : 0),
                    max = core ? core.maxHp : 1,
                    sel = game.selected;
                self.level.update(game.level?.name ?? i18n('info-none'));
                self.seed.update(game.seed ?? i18n('info-none'));
                self.hp.update(hp + '/' + max);
                self.hpFill.setWidth(self.hpBar.width * hp / max);
                if (sel) {
                    self.selected.update(
                        i18n('info-selected-value', i18n(sel.id === game.playerCoreId ? 'info-core' : 'info-linked'), sel.rank, sel.hp, sel.maxHp)
                    );
                } else {
                    self.selected.update(i18n('info-none'));
                }
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
            
            statusTxt = new PaddedPlainText(appView, {
                align:'center', valign:'bottom',
                valignOffset:FOOTER_HEIGHT + padding, padding, visible:false,
                textColor:colorText, fontSize:fontSizeMedium
            }, [{
                /*  Updates the overlays, once per frame. */
                update: function() {
                    let status = '';
                    if (V.placeMode) {
                        status = i18n(V.placeMode.stage === 'cell' ? 'status-place-cell' : 'status-place-link');
                    } else if (V.healMode) {
                        status = i18n('status-heal', game.healAmount());
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
            
            // Carry on with the saved game, if there is one, or else show the default level's
            // brief. ready is true once either is done; the level loads asynchronously. Help
            // follows on a first visit.
            const whenReady = () => {
                appView.ready = true;
                if (!hasSeenHelp()) appView.openHelp();
            };
            appView.ready = false;
            persistenceMgr = new pkg.PersistenceManager(game);
            if (persistenceMgr.hasSave()) {
                appView.loadSave();
                whenReady();
            } else {
                levels.loadIndex(index => {
                    if (index) {
                        appView.briefLevel(index.defaultLevel, whenReady);
                    } else {
                        whenReady();
                    }
                });
            }
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
            new IconBtn(hdrView, {icon:'map', label:i18n('lbl-levels'), tooltip:i18n('tip-levels')}, [{
                doActivated:appView.openLevels
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
            placeBtn = new ToggleBtn(ftrView, {text:i18n('btn-place', 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {
                    if (!game.over) {
                        V.healMode = false;
                        if (V.placeMode) {
                            V.placeMode = null;
                        } else if (game.canAffordPlace()) {
                            V.placeMode = {stage:'cell'};
                        }
                        draw();
                    }
                }
            }]);
            healBtn = new ToggleBtn(ftrView, {text:i18n('btn-heal', 1, 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {
                    if (!game.over) {
                        V.placeMode = null;
                        V.healMode = !V.healMode && game.canAffordHeal() && game.anyDamaged();
                        draw();
                    }
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
            const gameOver = game.over,
                placeCost = game.placeCost(),
                healCost = game.healCost(),
                healAmount = game.healAmount();
            
            movesView.update(game.movesLeft() + '/' + game.moveLimit());
            
            endTurnBtn.setDisabled(gameOver);
            saveBtn.setDisabled(gameOver);
            exportBtn.setDisabled(gameOver);
            
            placeBtn.setTextAndFit(i18n('btn-place', placeCost));
            placeBtn.setTooltip(i18n('tip-place', placeCost));
            placeBtn.setDisabled(gameOver || (!V.placeMode && !game.canAffordPlace()));
            placeBtn.setOn(!!V.placeMode);
            
            healBtn.setTextAndFit(i18n('btn-heal', healAmount, healCost));
            healBtn.setTooltip(i18n('tip-heal', healCost, healAmount));
            healBtn.setDisabled(gameOver || (!V.healMode && (!game.canAffordHeal() || !game.anyDamaged())));
            healBtn.setOn(V.healMode);
            
            
            infoPanel.update();
            statusTxt.update();
            
            if (game.over && !gameOverShown) {
                gameOverShown = true;
                setTimeout(() => {
                    // With a save, closing loads it instead.
                    const hasSave = persistenceMgr.hasSave();
                    openConfirmMsgDialog(
                        i18n('dlg-game-over-title'),
                        i18n('dlg-game-over-msg', game.scoreEarned, game.turn),
                        () => {appView.briefNewGame();},
                        hasSave ? () => {appView.loadSave();} : null,
                        i18n('btn-play-again'), hasSave ? i18n('btn-load-save') : I18N_CLOSE_BTN
                    );
                }, 500);
            }
        },
        
        newGame: () => {
            gameOverShown = false;
            V.placeMode = null;
            V.healMode = false;
            game.reset();
            centerOn(false);
        },
        
        /*  Replaces this game with the saved one. If the save can't be used, it's cleared,
            this game carries on, and a dialog says why. */
        loadSave: () => {
            const problem = persistenceMgr.restore();
            if (problem) {
                openAckMsgDialog(i18n('dlg-restore-failed-title'), i18n('dlg-restore-failed-msg', problem));
                updateLastSaved();
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
        
        /*  Loads a level and shows its brief, with the level's values in effect so its
            settings can be set there. Start begins a new game in it with the seed shown;
            Cancel puts the game's own level values back and the game carries on. If the
            level can't be loaded, a dialog says so and the game carries on. callback, if
            given, is called once it's done, whichever way. */
        briefLevel: (id, callback) => {
            levels.loadLevel(id, level => {
                if (!level) {
                    openAckMsgDialog(i18n('dlg-level-failed-title'), i18n('dlg-level-failed-msg', id));
                    callback?.();
                    return;
                }
                openWhenClear(() => {
                    const attrs = settings.applyLevel(id, level.attrs);
                    levelBrief ??= new pkg.LevelBrief(appView);
                    levelBrief.show(level, {
                        seed:Number.isInteger(level.seed) ? level.seed : pkg.randomSeed(),
                        underway:!game.over && game.turn > 1,
                        onStart: seed => {
                            game.level = {id, name:level.name, attrs};
                            game.seed = seed;
                            appView.newGame();
                            callback?.();
                        },
                        onCancel: () => {
                            settings.applyLevel(game.level?.id, game.level?.attrs);
                            draw();
                            callback?.();
                        }
                    });
                });
            });
        },
        
        /*  The brief for the level being played, or a new game straight away when there are
            no levels. */
        briefNewGame: () => {
            if (game.level) {
                appView.briefLevel(game.level.id);
            } else {
                appView.newGame();
            }
        },
        
        /*  Called when a setting changes (id is null when they're all reset), so the game
            reflects it at once. */
        notifySettingChanged: (_id, _value) => {
            game.recomputeRanks();
            draw();
        },
        
        
        // Opening Dialogs /////////////////////////////////////////////////////
        openLevels: () => {
            levelsDialog ??= new pkg.LevelsDialog(appView, {onPlay:id => {appView.briefLevel(id);}});
            levelsDialog.show(game.level?.id);
            return levelsDialog;
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
        /** @private */
        _keyDown: function(e) {
            if (e.metaKey || e.ctrlKey || e.altKey || isAnyShowing()) return;
            
            const k = keyOf(e);
            if (k === ' ') {
                e.preventDefault();
                centerOn();
            } else if (!game.over) {
                if (k === 'Escape') {cancelModes(); return;}
                if (k === 'p') {placeBtn.doActivated(); return;}
                if (k === 'h') {healBtn.doActivated(); return;}
                if (k === 'Tab') {
                    e.preventDefault();
                    const mine = game.piecesOf('player');
                    if (!mine.length) return;
                    const i = mine.findIndex(p => p.id === game.selectedId);
                    game.selectedId = mine[(i + (e.shiftKey ? mine.length - 1 : 1)) % mine.length].id;
                    cancelModes();
                    return;
                }
                if (V.placeMode || V.healMode) return;
                if (k === '.' || k === 'Numpad5' || k === 'Enter') {
                    e.preventDefault();
                    endTurn();
                    return;
                }
                const d = pkg.GRID.keyDirs[k];
                if (!d) return;
                
                e.preventDefault();
                const sel = game.selected;
                if (sel && game.playerAct(sel, sel.x + d[0], sel.y + d[1])) gameView.afterTurn();
            }
        }
    });
})(hc);
