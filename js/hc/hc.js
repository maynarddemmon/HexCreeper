(pkg => {
    'use strict';
    
    const M = myt,
        
        DOM_PARSER = new DOMParser(), // Used by stripMarkup
        
        // Localization
        {get:i18n} = (locale => {
            const I18N = M.I18N,
                getResource = I18N.getResource;
            I18N.setLocale(locale);
            
            for (const funcName of ['getOrdinal','concatenate']) {
                I18N[funcName] = getResource(funcName);
            }
            
            return I18N;
        })(LOCALE_KEY);
    
    pkg.hc = {
        app:null, // Holds the App instance.
        
        /*  Colors are the page's CSS variables (see index.html), so the UI follows the same
            color scheme. */
        theme:{
            layoutSpacing:1,
            spacing:2,
            padding:8,
            cornerRadius:6,
            btnHeight:24,
            rowHeight:28,
            
            fontSizeMicro:'10px',
            fontSizeSmall:'12px',
            fontSizeMedium:'14px',
            fontSizeLarge:'16px',
            fontSizeVeryLarge:'20px',
            
            fontFamilyMono:'SpaceMono, ui-monospace, monospace',
            
            colorHeaderBg:'var(--header-bg)',
            colorHeaderText:'var(--header-text)',
            colorPanel:'var(--dlg-bg)',
            colorPanelHeader:'var(--dlg-header)',
            colorPanelFooter:'var(--dlg-footer)',
            colorText:'var(--ink)',
            colorTextMuted:'var(--muted)',
            colorBtn:'var(--core-dark)',
            colorAccent:'var(--core)',
            colorSuccess:'var(--gain)',
            colorError:'var(--dmg)'
        },
        
        cfg:{
            // Where help.txt is loaded from.
            DATA_BASE_DIR:'./data/',
            
            // The height of the top "header" view in the App.
            TOP_VIEW_HEIGHT:44,
            
            // Dialogs
            DEFAULT_TALL_DIALOG_WIDTH:560,
            DIALOG_FOOTER_HEIGHT:40,
            
            // The project's home, linked from the header's GitHub mark.
            GITHUB_URL:'https://github.com/maynarddemmon/HexCreeper',
            
            // Look //
            PIECE_R:0.25, // piece radius as a fraction of a cell
            
            OWNERS:{
                player:{fill:'--core',  stroke:'--core-dark'},
                enemy: {fill:'--enemy', stroke:'--enemy-dark'},
            },
            
            // Gameplay //
            WORLD_LIMIT:1000000,
            
            // Quadrants: the world is divided into hexagonal quadrants of radius QUAD.radius.
            // Whenever a player piece is in a quadrant, that quadrant and its 6 neighbours
            // get their tiles generated (once each, never cleaned up). Visited quadrants are tinted.
            QUAD:{
                radius:3 // applies to new games; the start cell (0,0) is the centre of quadrant (0,0)
            },
            
            // Links between pieces.
            LINK:{
                range:3 // The maximum distance a linked piece can get from another one.
            },
            
            // Enemy squad planning (see Game.planSquad).
            AI:{
                planRange:6,   // squads whose nearest piece is within this many steps plan their turn
                beam:12,       // plans kept per search step
                hit:10,        // value of each hit on a player piece
                killPer:6,     // extra value per player piece destroyed (incl. pieces linked below it)
                coreHit:15,    // extra value for hitting the player's core
                coreKill:1000, // destroying the core
                expose:12,     // caution: penalty per piece (incl. pieces linked below) left next to a player piece
                poise:1,       // bonus for a piece ending exactly 2 steps away (can strike next turn, can't be hit)
                approach:0.5,  // penalty per step of distance for pieces further away
                patience:2,    // turns without a hit before a nearby squad stops caring about exposure
            },
            
            // Rank: a player piece's rank = max(base, 1 + min of its two highest-ranked children)
            // (a missing child counts as 0, so a piece needs two children to rank up).
            RANK:{
                base:1,         // rank of a piece without two children
                hpPer:2,        // max HP = hpPer x the piece's own rank
                movesPer:1,     // pieces you may move per turn = movesPer x highest rank of any piece
                costPer:5,      // cost to place a piece = costPer x core rank
                healScorePer:1, // each unused heal unit becomes this much score
                rankUpHeals:0,  // 1: when max HP rises with rank, HP rises too; 0: the new HP must be healed
                healCostPer:5,  // Heal action cost = healCostPer x core rank
                healPer:1,      // Heal action heals healPer x core rank
            },
            
            // Enemy spawning
            SPAWN:{
                initial:3,   // enemies at game start
                minDist:6,   // spawn ring (Chebyshev distance from the player's core)
                maxDist:9,
                clearance:4, // never spawn closer than this to any player piece
                every:3,     // spawn a wave every N turns
            },
            
            // Tiles appear with a countdown (turns) and become active when it reaches 0.
            TILES:{
                healPerQuad:1,
                harmPerQuad:1,
                timerMin:2,
                timerMax:8,
                harmDamage:1, // damage to any piece that moves onto an active harm tile
            },
            
            // Heal tile value = floor(unvisited neighbouring quadrants / per) + base,
            // i.e. 8 -> 5, 6-7 -> 4, 4-5 -> 3, 2-3 -> 2, 0-1 -> 1 with the defaults.
            HEAL:{
                amount:1, // amount: base value;
                per:2     // per: unvisited quadrants per +1
            },
            
            // After a player attack that kills, the attacking piece (with its group) steps
            // into the attacked direction if the whole group can legally do so (not onto harm).
            COMBAT:{
                advance:1 // a linked piece must stay within this many steps of its link parent
            },
            
            // Enemy squads: enemies are link trees too (same rank rules as the player).
            ENEMY:{
                hpPer:1,    // enemy max HP = hpPer x its rank
                maxSquad:16, // hard cap on squad size
            },
            
            // Enemy pressure follows the player's strength, not the clock. R = your
            // highest piece rank (the same number that sets your moves per turn).
            //   enemies per wave = base + perRank x (R - 1)  [+ 1 per timeEvery turns, if set]
            //   largest squad    = R + squadExtra (capped at ENEMY.maxSquad)
            // Losing rank lowers the pressure again.
            PRESSURE:{
                base:1,       // enemies per wave at rank 1
                perRank:2,    // extra enemies per wave for each rank above 1
                squadExtra:1, // largest squad = rank + squadExtra
                timeEvery:0,  // optional slow clock ramp: +1 enemy per wave every N turns (0 = off)
            }
        },
        
        // Icons
        ICON_SEPARATOR:'\u00A0·\u00A0',
        ICON_HELP:'?',
        ICON_SETTINGS:'⚙',
        ICON_CENTER:'⌖',
        ICON_RESTART:'⌫',
        ICON_CHECKED:'✓',
        ICON_UNCHECKED:'✗',
        ICON_CANCEL:'X',
        
        loadTxt: (url, callback) => {
            M.doFetch(url, {}, true,
                response => {
                    callback?.(true, response);
                },
                err => {
                    console.error('err', err);
                    callback?.(false, err);
                }
            );
        },
        
        wrapInStyledSpan: (txt, color, fontFamily, fontSize) => {
            let css = '';
            if (color) css += 'color:' + color + ';';
            if (fontFamily) css += 'font-family:' + fontFamily + ';';
            if (fontSize) css += 'font-size:' + fontSize + ';';
            return '<span style="' + css + '">' + txt + '</span>';
        },
        
        stripMarkup: str => str ? DOM_PARSER.parseFromString(str, 'text/html').body.textContent || '' : ''
    };
})(window);
