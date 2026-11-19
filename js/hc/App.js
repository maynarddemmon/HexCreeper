(pkg => {
    'use strict';
    
    let appView,
        gameView,
        
        scoreView,
        rankView,
        movesView,
        endTurnBtn,
        placeBtn,
        healBtn,
        
        gameOverShown = false,
        settingsDialog;
    
    const M = myt,
        {View, PlainText, I18N:{get:i18n}} = M,
        
        {
            Btn, ToggleBtn, SquareBtn, WideView, Spacer, LabeledValue,
            dialogUtil:{openConfirmMsgDialog, openAckMsgDialog, isAnyShowing},
            theme:{
                spacing, padding, 
                colorHeaderBg, colorHeaderText, colorBtn, 
                fontSizeMedium, fontSizeLarge, fontSizeVeryLarge, fontFamilyMono
            },
            cfg:{
                DATA_BASE_DIR, TOP_VIEW_HEIGHT, GITHUB_URL
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
            
            attrs.minWidth = 960;
            attrs.minHeight = 560;
            
            appView.callSuper(parent, attrs);
            
            // For tests and the console.
            appView.game = game;
            
            appView.buildTopView(new WideView(appView, {bgColor:colorHeaderBg, height:TOP_VIEW_HEIGHT}));
            gameView = appView.gameView = new pkg.GameView(appView, {
                y:TOP_VIEW_HEIGHT, percentOfParentHeight:100, percentOfParentHeightOffset:-TOP_VIEW_HEIGHT
            });
            
            // Capture phase: myt's global key handling stops keydown from bubbling.
            window.addEventListener('keydown', appView._keyDown.bind(appView), true);
            window.addEventListener('resize', () => V.resize());
            
            game.reset(); // With the stored settings, now they're in effect.
            V.resize();
            gameView.centerOn(game.playerCore);
            
            if (!hasSeenHelp()) appView.openHelp();
        },
        
        
        // Methods /////////////////////////////////////////////////////////////
        buildTopView: topView => {
            topView.setTextColor(colorHeaderText);
            
            new PlainText(topView, {text:i18n('game-title'), fontSize:fontSizeVeryLarge, fontWeight:'bold', fontFamily:fontFamilyMono});
            
            new Spacer(topView);
            
            const statAttrs = {textColor:colorHeaderText, valueTextColor:colorBtn};
            scoreView = new LabeledValue(topView, {label:i18n('lbl-score'), ...statAttrs});
            rankView = new LabeledValue(topView, {label:i18n('lbl-rank'), ...statAttrs});
            movesView = new LabeledValue(topView, {label:i18n('lbl-moves'), ...statAttrs, paddingRight:padding});
            
            new Spacer(topView);
            
            endTurnBtn = new Btn(topView, {buttonType:'solid', text:i18n('btn-end-turn'), fontSize:fontSizeMedium, tooltip:i18n('tip-end-turn')}, [{
                doActivated: endTurn
            }]);
            placeBtn = new ToggleBtn(topView, {text:i18n('btn-place', 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {gameView.togglePlace();}
            }]);
            healBtn = new ToggleBtn(topView, {text:i18n('btn-heal', 1, 5), fontSize:fontSizeMedium}, [{
                doActivated: () => {gameView.toggleHeal();}
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_CENTER, fontSize:fontSizeVeryLarge, tooltip:i18n('tip-center')}, [{
                doActivated: () => {appView.centerOn(game.playerCore);}
            }]);
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_RESTART, fontSize:fontSizeLarge, tooltip:i18n('tip-new-game')}, [{
                doActivated: () => {appView.confirmNewGame();}
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_SETTINGS, fontSize:fontSizeVeryLarge, tooltip:i18n('tip-settings')}, [{
                doActivated: () => {appView.openSettings();}
            }]);
            new SquareBtn(topView, {buttonType:'underline', text:pkg.ICON_HELP, fontSize:fontSizeLarge, tooltip:i18n('tip-help')}, [{
                doActivated: () => {appView.openHelp();}
            }]);
            
            new PlainText(topView, {text:ICON_SEPARATOR});
            
            // GitHub's mark, linking to the project in a new tab.
            const githubBtn = new SquareBtn(topView, {buttonType:'underline', text:'', tooltip:i18n('tip-github')}, [{
                    doActivated: () => {window.open(GITHUB_URL, '_blank', 'noopener');}
                }]),
                githubMarkSize = 20,
                githubMark = new View(githubBtn, {
                    width:githubMarkSize, height:githubMarkSize, align:'center', valign:'middle',
                    imageUrl:GITHUB_MARK_URL, imageSize:'contain'
                }, [M.ImageSupport]);
            githubMark.getIDS().pointerEvents = 'none';
            githubBtn.getIDE().setAttribute('aria-label', i18n('tip-github'));
            
            new M.ResizeLayout(topView, {inset:padding, spacing:spacing, outset:padding});
            new M.ConstantLayout(topView, {targetAttrName:'valign', targetValue:'middle'});
        },
        
        /*  Called once per frame, as the board is drawn: updates the header and overlays,
            and offers a new game once the core is destroyed. */
        update: () => {
            scoreView.update(game.score);
            const coreRank = game.coreRank(), maxRank = game.maxRank();
            rankView.update(maxRank > coreRank ? i18n('lbl-rank-top', coreRank, maxRank) : coreRank);
            movesView.update(game.movesLeft() + ' / ' + game.moveLimit());
            
            endTurnBtn.setDisabled(game.over);
            
            const placeCost = game.placeCost();
            placeBtn.setTextAndFit(i18n('btn-place', placeCost));
            placeBtn.setTooltip(i18n('tip-place', placeCost));
            placeBtn.setDisabled(game.over || (!V.placeMode && !game.canAffordPlace()));
            placeBtn.setOn(!!V.placeMode);
            
            const healCost = game.healCost(), healAmount = game.healAmount();
            healBtn.setTextAndFit(i18n('btn-heal', healAmount, healCost));
            healBtn.setTooltip(i18n('tip-heal', healCost, healAmount));
            healBtn.setDisabled(game.over || (!V.healMode && (!game.canAffordHeal() || !game.anyDamaged())));
            healBtn.setOn(V.healMode);
            
            gameView.update();
            
            if (game.over && !gameOverShown) {
                gameOverShown = true;
                setTimeout(() => {
                    openConfirmMsgDialog(
                        i18n('dlg-game-over-title'),
                        i18n('dlg-game-over-msg', game.score, game.turn),
                        () => {appView.newGame();},
                        null,
                        i18n('btn-play-again'), I18N_CLOSE_BTN
                    );
                }, 500);
            }
        },
        
        centerOn: p => {if (p) gameView.centerOn(p);},
        handleClick: (c, force) => gameView.handleClick(c, force),
        
        newGame: () => {
            gameOverShown = false;
            V.placeMode = null;
            V.healMode = false;
            game.reset();
            gameView.centerOn(game.playerCore);
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
            reflects it at once. A new grid starts a new game. */
        notifySettingChanged: (id, _value) => {
            if (id === pkg.SETTING_GRID) {
                appView.newGame();
            } else {
                game.recomputeRanks();
                draw();
            }
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
                return;
            }
            if (game.over) return;
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
    });

    // Rendering calls this each frame.
    V.updateHud = () => {pkg.app?.update();};
})(hc);
