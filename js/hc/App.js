(pkg => {
    'use strict';
    
    let appView,
        gameView,
        
        scoreView,
        rankView,
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
        settingsDialog;
    
    const M = myt,
        {View, PlainText, I18N:{get:i18n}} = M,
        
        {
            Btn, ToggleBtn, IconBtn, WideView, Spacer, LabeledValue,
            dialogUtil:{openConfirmMsgDialog, openAckMsgDialog, isAnyShowing},
            theme:{
                spacing, padding, 
                colorHeaderBg, colorHeaderText, colorBtn, 
                fontSizeMedium, fontSizeVeryLarge, fontFamilyMono
            },
            cfg:{
                DATA_BASE_DIR, HEADER_HEIGHT, FOOTER_HEIGHT, GITHUB_URL
            },
            ICON_SEPARATOR
        } = pkg,
        
        V = pkg.view,
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
            gameOverShown = false;
            V.placeMode = null;
            V.healMode = false;
            gameView.centerOn(game.playerCore);
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
        };
    
    /*  What gets stored into hc.app. This is myt root view with a header bar across the 
        top and the game below it. Handles the keyboard, the dialogs and setting changes. */
    pkg.App = new JS.Class('App', View, {
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
                y:HEADER_HEIGHT, percentOfParentHeight:100, percentOfParentHeightOffset:-(HEADER_HEIGHT + FOOTER_HEIGHT)
            });
            appView.buildFtrView(new WideView(appView, {bgColor:colorHeaderBg, height:FOOTER_HEIGHT, valign:'bottom'}));
            
            // Capture phase: myt's global key handling stops keydown from bubbling.
            window.addEventListener('keydown', appView._keyDown.bind(appView), true);
            window.addEventListener('resize', () => V.resize());
            
            game.reset(); // With the stored settings, now they're in effect.
            
            // Carry on with the saved game, if there is one.
            persistenceMgr = new pkg.PersistenceManager(game);
            if (persistenceMgr.hasSave()) appView.loadSave();
            updateLastSaved();
            
            V.resize();
            gameView.centerOn(game.playerCore);
            
            if (!hasSeenHelp()) appView.openHelp();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        buildHdrView: hdrView => {
            hdrView.setTextColor(colorHeaderText);
            
            new PlainText(hdrView, {text:i18n('game-title'), fontSize:fontSizeVeryLarge, fontWeight:'bold', fontFamily:fontFamilyMono});
            
            new Spacer(hdrView);
            
            const statAttrs = {textColor:colorHeaderText, valueTextColor:colorBtn};
            turnView = new LabeledValue(hdrView, {label:i18n('lbl-turn'), ...statAttrs});
            scoreView = new LabeledValue(hdrView, {label:i18n('lbl-score'), ...statAttrs});
            rankView = new LabeledValue(hdrView, {label:i18n('lbl-rank'), ...statAttrs});
            movesView = new LabeledValue(hdrView, {label:i18n('lbl-moves'), ...statAttrs, paddingRight:padding});
            
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
            new IconBtn(hdrView, {icon:'rotate-ccw', label:i18n('lbl-new-game'), tooltip:i18n('tip-new-game')}, [{
                doActivated:appView.confirmNewGame
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
            
            endTurnBtn = new Btn(ftrView, {buttonType:'solid', text:i18n('btn-end-turn'), fontSize:fontSizeMedium, tooltip:i18n('tip-end-turn')}, [{
                doActivated:endTurn
            }]);
            placeBtn = new ToggleBtn(ftrView, {text:i18n('btn-place', 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {gameView.togglePlace();}
            }]);
            healBtn = new ToggleBtn(ftrView, {text:i18n('btn-heal', 1, 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {gameView.toggleHeal();}
            }]);
            
            new IconBtn(ftrView, {icon:'locate-fixed', label:i18n('lbl-center'), tooltip:i18n('tip-center')}, [{
                doActivated: () => {appView.centerOn(game.playerCore);}
            }]);
            
            new Spacer(ftrView);
            
            new M.ResizeLayout(ftrView, {inset:padding, spacing:spacing, outset:padding});
            new M.ConstantLayout(ftrView, {targetAttrName:'valign', targetValue:'middle'});
        },
        
        /*  Called once per frame, as the board is drawn: updates the header and overlays,
            and offers a new game once the core is destroyed. */
        update: () => {
            turnView.update(game.turn);
            scoreView.update(game.score);
            const coreRank = game.coreRank(),
                maxRank = game.maxRank(),
                gameOver = game.over,
                placeCost = game.placeCost(),
                healCost = game.healCost(),
                healAmount = game.healAmount();
            
            rankView.update(maxRank > coreRank ? i18n('lbl-rank-top', coreRank, maxRank) : coreRank);
            movesView.update(game.movesLeft() + ' / ' + game.moveLimit());
            
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
            
            gameView.update();
            
            if (game.over && !gameOverShown) {
                gameOverShown = true;
                setTimeout(() => {
                    // With a save, closing loads it instead.
                    const hasSave = persistenceMgr.hasSave();
                    openConfirmMsgDialog(
                        i18n('dlg-game-over-title'),
                        i18n('dlg-game-over-msg', game.score, game.turn),
                        () => {appView.newGame();},
                        hasSave ? () => {appView.loadSave();} : null,
                        i18n('btn-play-again'), hasSave ? i18n('btn-load-save') : I18N_CLOSE_BTN
                    );
                }, 500);
            }
        },
        
        // Centres the board on p, or on the start cell if there's no p (e.g. the core is gone).
        centerOn: p => {gameView.centerOn(p ?? {x:0, y:0});},
        handleClick: (c, force) => gameView.handleClick(c, force),
        
        newGame: () => {
            gameOverShown = false;
            V.placeMode = null;
            V.healMode = false;
            game.reset();
            gameView.centerOn(game.playerCore);
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
        
        /*  Asks first, unless the game is over or hasn't started. */
        confirmNewGame: () => {
            if (game.over || game.turn === 1) {
                appView.newGame();
            } else {
                openConfirmMsgDialog(i18n('dlg-new-game-title'), i18n('dlg-new-game-msg'), () => {appView.newGame();});
            }
        },
        
        /*  Called when a setting changes (id is null when they're all reset), so the game
            reflects it at once. */
        notifySettingChanged: (_id, _value) => {
            game.recomputeRanks();
            draw();
        },
        
        
        // Opening Dialogs /////////////////////////////////////////////////////
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
                appView.centerOn(game.playerCore);
            } else if (!game.over) {
                if (k === 'Escape') {gameView.cancelModes(); return;}
                if (k === 'p') {gameView.togglePlace(); return;}
                if (k === 'h') {gameView.toggleHeal(); return;}
                if (k === 'Tab') {
                    e.preventDefault();
                    const mine = game.piecesOf('player');
                    if (!mine.length) return;
                    const i = mine.findIndex(p => p.id === game.selectedId);
                    game.selectedId = mine[(i + (e.shiftKey ? mine.length - 1 : 1)) % mine.length].id;
                    gameView.cancelModes();
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

    // Rendering calls this each frame.
    V.updateHud = () => {pkg.app?.update();};
})(hc);
