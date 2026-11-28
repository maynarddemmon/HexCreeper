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
        })(LOCALE_KEY),
        
        VAR_LEVEL = 'level',
        VAR_XP = 'xp',
        
        AP_UNIT = 100, // Action Points are kept to the hundredth of a point.
        XP_UNIT = 100, // Hit Points are kept to the hundredth of a point.
        STATS = ['str', 'agl', 'con', 'dex', 'int', 'wis', 'wil', 'cha'],
        
        FIXTURE_HEAL = 'heal',
        FIXTURE_HARM = 'harm',
        FIXTURE_LOOT = 'loot',
        FIXTURE_FEATURE = 'feature',
        
        // Units: what weights (grams) and volumes (cubic centimetres) are shown in
        GRAMS_PER_POUND = 453.59237,
        CM3_PER_GALLON = 3785.411784,
        // n to 3 significant figures, but no more than 2 decimals (a whole number from 100),
        // as text: "<0.01" for less than that
        roughly = n => n > 0 && n < 0.005 ? '<0.01' :
            String(n >= 100 ? Math.round(n) : Number(Number(n.toPrecision(3)).toFixed(2)));
    
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
            colorMenu:'var(--menu-bg)',
            colorPanelHeader:'var(--dlg-header)',
            colorPanelFooter:'var(--dlg-footer)',
            colorText:'var(--ink)',
            colorTextMuted:'var(--muted)',
            colorBtn:'var(--core-dark)',
            colorAccent:'var(--core)',
            colorSuccess:'var(--gain)',
            colorError:'var(--dmg)'
        },
        
        
        // Entities and Characters //
        AP_UNIT,
        XP_UNIT,
        STATS,
        CHARACTER_NAME_MAX:64, // the longest a character's name can be
        CHARACTER_DESCRIPTION_MAX:1024, // and its description
        
        // Items (see Items.js)
        ITEM_GOLD:'gold_coin', // gold: what loot gives, and placing a piece costs
        
        // Status Effects (the ones the code uses: see Effects.js)
        EFFECT_EXHAUSTED:'exhausted',
        EFFECT_RALLYING:'rallying',
        EFFECT_RALLIED:'rallied',
        
        // Move Modes (see Movement.js)
        MOVE_MODES:['fixed', 'free', 'follow'],
        PLAYER_MOVE_MODES:['fixed', 'follow'], // those you can set your moves to
        
        // Expression Vars
        VAR_XP,
        VAR_LEVEL,
        
        STAT_VARS: [VAR_LEVEL, ...STATS],
        XP_VARS: [VAR_XP, 'rank', 'parentRank', VAR_LEVEL], // the parentXPShare and childXPBonus rules'
        MULTI_KILL_VARS: [VAR_XP, 'killCount', VAR_LEVEL], // the multiKillBonusXP rule's
        DAMAGE_VARS: ['min', 'max', 'roll', 'roll2'], // the damageRoll rule's
        COST_VARS: ['coreLevel', 'maxLevel', 'levels'], // the cost rules': your core's level, your highest, and your pieces' together (see Game.costRule)
        
        // Tile Types (the terrain: a cell with none is plain floor; heals, harms and loot
        // are fixtures: see Fixtures.js)
        TILE_TYPE_FLOOR:'floor',
        TILE_TYPE_HOLE:'hole',
        TILE_TYPE_SOLID:'solid',
        
        // Fixture Types (see Fixtures.js)
        FIXTURE_HEAL,
        FIXTURE_HARM,
        FIXTURE_LOOT,
        FIXTURE_FEATURE,
        FIXTURE_TYPES:[FIXTURE_HEAL, FIXTURE_HARM, FIXTURE_LOOT, FIXTURE_FEATURE],
        
        cfg:{
            // Where help.txt is loaded from.
            DATA_BASE_DIR:'./data/',
            
            // The height of the top "header" view in the App.
            HEADER_HEIGHT:32,
            FOOTER_HEIGHT:32,
            
            // Dialogs
            DEFAULT_TALL_DIALOG_WIDTH:560,
            DIALOG_HEADER_HEIGHT:32,
            DIALOG_FOOTER_HEIGHT:32,
            
            // How exported save files are written: "compact" (as small as possible, one line)
            // or "pretty" (indented, to read). Either can be imported.
            EXPORT_FORMAT:'pretty',
            
            // The project's home, linked from the header's GitHub mark.
            GITHUB_URL:'https://github.com/maynarddemmon/HexCreeper',
            
            // The camera. It pans (animated) to keep your core at least FOLLOW_MARGIN % of the
            // way from the edges of the board to its middle (a preference), one hex at a
            // time, and pans over PAN_MS.
            FOLLOW_MARGIN:30,
            PAN_MS:250,
            
            // Whether the combat log shows (a preference; K toggles it).
            COMBAT_LOG:true,
            
            // What weights and volumes are shown in (a preference): "metric" (kilograms and
            // litres) or "imperial" (pounds and US gallons). The game keeps them in grams
            // and cubic centimetres.
            UNITS:'metric',
            
            // Shadows of solids and holes (see Render.js), from one light: angle (degrees
            // clockwise from pointing right, so 90 is straight down), color, blur (px) and
            // length (in hexes, unless a solid or hole subtype says: its shadowLength).
            // data/environs.json5's "shadow" goes over these. on: whether they're drawn (a
            // preference).
            SHADOW:{
                on:true,
                angle:90,
                color:'#0003',
                blur:2,
                length:0.5
            },
            
            // Animation: a piece's step takes MOVE_MS and a jump JUMP_MS, during which it grows
            // by up to JUMP_GROW (as if rising towards you) and back. An attack's bump takes
            // BUMP_MS. on: whether pieces' moves are animated at all; speed: how fast, in %
            // (the times are divided by it: see animMs). Both are preferences.
            ANIM:{
                on:true,
                speed:100,
                MOVE_MS:250,
                JUMP_MS:500,
                JUMP_GROW:0.35,
                BUMP_MS:250
            },
            
            // Look //
            PIECE_R:0.25, // piece radius as a fraction of a cell
            CORE_BORDER:0.08, // your core's thick border; the core is bigger by this much
            RING_GAP:0.07, // the gap between a piece's edge and a ring around it (selection etc.)
            
            OWNERS:{
                player:{fill:'--core',  stroke:'--core-dark'},
                enemy: {fill:'--enemy', stroke:'--enemy-dark'},
            },
            
            // Gameplay //
            WORLD_LIMIT:1000000,
            
            // The gameplay values a map can set, its rules, have their defaults in
            // Settings.js (RULES), and the map components' tuning is in their attrs (see
            // MapComponent.js).
            
            // Enemy spawning (the rest is the spawn generator's attrs; see Generators.js).
            SPAWN:{
                clearance:4 // never spawn closer than this to any player piece
            },
            
            // Fog of war: you see enemies only on cells in sight of one of your pieces: within
            // the visionRadius rule's steps, with the line between the two cell centres not
            // blocked by solid tiles. Tiles stay shown once seen.
            VISION:{
                fog:true
            }
        },
        
        // Icons
        ICON_SEPARATOR:'\u00A0·\u00A0',
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
        
        stripMarkup: str => str ? DOM_PARSER.parseFromString(str, 'text/html').body.textContent || '' : '',
        
        /*  A seeded pseudo-random number generator (mulberry32): a function returning numbers
            in [0, 1), the same sequence for the same 32-bit seed. */
        makeRng: seed => {
            let a = seed >>> 0;
            return () => {
                a = (a + 0x6D2B79F5) >>> 0;
                let t = a;
                t = Math.imul(t ^ (t >>> 15), t | 1);
                t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        },
        
        /*  A 32-bit hash of a string (FNV-1a), e.g. to make a seed for one part of a map. */
        hashString: str => {
            let h = 0x811C9DC5;
            for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
            return h >>> 0;
        },
        
        /*  A new seed for a map: a random whole number below a million, easy to note down. */
        randomSeed: () => Math.floor(Math.random() * 1000000),
        
        /*  An animation time (ms, one of cfg.ANIM's) at the Animation speed preference. */
        animMs: ms => ms * 100 / pkg.hc.cfg.ANIM.speed,
        
        // Object Utility
        isObj: v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        // Math Utility
        isNatNum: v => Number.isInteger(v) && v >= 0,
        isIntOfAtLeast: (v, min=0) => Number.isInteger(v) && v >= min,
        isIntBetween: (v, min=0, max=Infinity) => Number.isInteger(v) && v >= min && v <= max,
        
        // Formatting
        formatAp: ap => String(ap / AP_UNIT),
        formatXp: xp => String(xp / XP_UNIT),
        // A weight (grams) or a volume (cubic centimetres) in the Units preference's units,
        // e.g. "2.36 kg", "5.2 lb", "0.3 L", "0.08 gal"
        formatWeight: g => pkg.hc.cfg.UNITS === 'imperial' ?
            roughly(g / GRAMS_PER_POUND) + ' lb' : roughly(g / 1000) + ' kg',
        formatVolume: cm3 => pkg.hc.cfg.UNITS === 'imperial' ?
            roughly(cm3 / CM3_PER_GALLON) + ' gal' : roughly(cm3 / 1000) + ' L'
    };
})(window);
