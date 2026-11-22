/*  Preferences and map attrs: the two kinds of value that can stand in for hc.cfg's.
    
    Preferences are the player's, for the whole app (so far only whether pieces' moves are
    animated). They're shown in Settings and saved in the browser (hc.prefs, {id:value},
    only those changed from the default).
    
    Map attrs are values a map sets in place of hc.cfg's defaults: its file's "attrs",
    {id:value}. They're never shown to the player, and anything a map doesn't set is at its
    default. (They're tuned in code, or by a map for some special effect of its own.) */
(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            isObj,
            cfg:{AI, QUAD, VISION, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, RANK, ANIM}
        } = pkg,
        
        PREFS_KEY = 'hc.prefs',
        
        GROUP_DISPLAY = 'display',
        
        // A number edits obj[prop], kept to min..max.
        num = (id, obj, prop, min, max) => ({id, type:'number', obj, prop, min, max, defaultValue:obj[prop]}),
        
        // A boolean edits obj[prop] too.
        bool = (id, obj, prop) => ({id, type:'boolean', obj, prop, defaultValue:obj[prop]}),
        
        // A choice edits obj[prop] too, and holds one of the values options() gives:
        // [{value, label}].
        choice = (id, obj, prop, options) => ({id, type:'choice', obj, prop, options, defaultValue:obj[prop]}),
        
        // A preference: shown in Settings, in a group, with a label (setting-<id>).
        pref = (group, def) => ({...def, group, label:i18n('setting-' + def.id)}),
        
        // A set of subtypes (solids, holes, heals...), as choices. They're known once
        // init.json5 has loaded.
        optionsOf = subtypes => () => subtypes.list().map(s => ({value:s.id, label:s.id})),
        solidOptions = optionsOf(pkg.solids),
        holeOptions = optionsOf(pkg.holes),
        
        /*  Every preference. The SettingsDialog builds its UI from this list, so adding one
            here is enough to make it appear there. */
        PREFERENCES = [
            pref(GROUP_DISPLAY, bool('animate', ANIM, 'on'))
        ],
        
        GROUPS = [GROUP_DISPLAY].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:PREFERENCES.filter(def => def.group === id)
        })),
        
        /*  Every map attr. */
        MAP_ATTRS = [
            num('visionRadius',  VISION,   'radius', 1, 30),        // how far your pieces see
            
            num('spawnEvery',    SPAWN,    'every', 1, 50),         // a wave every this many turns
            num('pBase',         PRESSURE, 'base', 0, 50),          // enemies per wave at rank 1
            num('pPerRank',      PRESSURE, 'perRank', 0, 20),       // + enemies per wave per rank
            num('pSquadExtra',   PRESSURE, 'squadExtra', 0, 10),    // largest squad = rank + this
            num('pTime',         PRESSURE, 'timeEvery', 0, 500),    // +1 enemy per wave every this many turns (0: off)
            num('initial',       SPAWN,    'initial', 0, 50),       // enemies at the start
            num('minDist',       SPAWN,    'minDist', 2, 40),       // how far from your core they spawn
            num('maxDist',       SPAWN,    'maxDist', 2, 40),
            
            num('aiExpose',      AI,       'expose', 0, 50),        // enemy caution (0: reckless)
            num('aiPatience',    AI,       'patience', 1, 20),      // turns without a hit before caution drops
            num('enemyHpPer',    ENEMY,    'hpPer', 1, 20),         // enemy HP per rank
            num('maxSquad',      ENEMY,    'maxSquad', 1, 31),      // largest squad
            
            bool('advance',      COMBAT,   'advance'),              // advance after a kill
            num('linkRange',     LINK,     'range', 1, 20),
            choice('moveMode',   LINK,     'mode', () => pkg.MOVE_MODES.map(m => ({value:m, label:m}))), // at the start of a game
            num('rankBase',      RANK,     'base', 1, 10),
            num('hpPer',         RANK,     'hpPer', 1, 20),         // max HP per rank
            num('movesPer',      RANK,     'movesPer', 1, 10),      // moves per turn per top rank
            num('placeBase',     RANK,     'placeBase', 0, 100),    // place cost, base
            num('placePerPieces', RANK,    'placePerPieces', 1, 100), // place cost: +1 per this many pieces
            bool('rankUpHeals',  RANK,     'rankUpHeals'),          // ranking up adds HP too
            
            num('quadRadius',    QUAD,     'radius', 1, 6),         // applies to new games
            num('healPerQuad',   TILES,    'healPerQuad', 0, 20),
            num('harmPerQuad',   TILES,    'harmPerQuad', 0, 40),
            num('lootChance',    TILES,    'lootChance', 0, 100),   // % chance a heal tile is loot instead
            choice('healType',   TILES,    'healType', optionsOf(pkg.heals)),
            choice('harmType',   TILES,    'harmType', optionsOf(pkg.harms)),
            choice('lootType',   TILES,    'lootType', optionsOf(pkg.loots)),
            num('wallChance',    TILES,    'wallChance', 0, 100),   // % chance a quadrant border is a wall
            num('wallHoleChance', TILES,   'wallHoleChance', 0, 100), // % of walls made of holes
            num('doorMin',       TILES,    'doorMin', 0, 10),       // door width
            num('doorMax',       TILES,    'doorMax', 0, 10),
            num('solidMin',      TILES,    'solidMin', 0, 20),      // solid tiles per quadrant
            num('solidMax',      TILES,    'solidMax', 0, 20),
            num('holeMin',       TILES,    'holeMin', 0, 20),       // hole tiles per quadrant
            num('holeMax',       TILES,    'holeMax', 0, 20),
            choice('wallSolid',  TILES,    'wallSolid', solidOptions), // what walls and clumps are made of
            choice('clumpSolid', TILES,    'clumpSolid', solidOptions),
            choice('wallHole',   TILES,    'wallHole', holeOptions),
            choice('clumpHole',  TILES,    'clumpHole', holeOptions),
            
            num('healCostPer',   RANK,     'healCostPer', 0, 100),  // Heal action cost per core rank
            num('healActPer',    RANK,     'healPer', 1, 20),       // Heal action HP per core rank
            num('healScore',     RANK,     'healScorePer', 0, 20)   // unused heal: score per point
        ],
        
        PREFERENCES_BY_ID = new Map(PREFERENCES.map(def => [def.id, def])),
        MAP_ATTRS_BY_ID = new Map(MAP_ATTRS.map(def => [def.id, def])),
        
        /*  A value the preference or attr can hold, or undefined: booleans must be booleans,
            choices one of the options (any text, before the options are known), and numbers
            are rounded and clamped. */
        normalize = (def, value) => {
            if (def.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
            if (def.type === 'choice') {
                const options = def.options();
                return typeof value === 'string' && (!options.length || options.some(o => o.value === value)) ? value : undefined;
            }
            const n = Math.round(Number(value));
            return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : undefined;
        },
        
        /*  Puts a value into what it controls. */
        applyValue = (def, value) => {
            def.obj[def.prop] = value;
            // Keep the ranges the right way round.
            if (SPAWN.maxDist < SPAWN.minDist) SPAWN.maxDist = SPAWN.minDist;
            if (TILES.solidMax < TILES.solidMin) TILES.solidMax = TILES.solidMin;
            if (TILES.holeMax < TILES.holeMin) TILES.holeMax = TILES.holeMin;
            if (TILES.doorMax < TILES.doorMin) TILES.doorMax = TILES.doorMin;
        },
        
        /*  The preferences the player has changed: {id:value}. Unknown or invalid entries
            are dropped when read. */
        prefs = (() => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(PREFS_KEY));
                if (isObj(stored)) {
                    for (const id in stored) {
                        const def = PREFERENCES_BY_ID.get(id),
                            value = def ? normalize(def, stored[id]) : undefined;
                        if (value !== undefined) retval[id] = value;
                    }
                }
            } catch (err) {
                console.warn('Unable to read preferences', err);
            }
            return retval;
        })(),
        
        writePrefs = () => {
            try {
                if (Object.keys(prefs).length) {
                    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
                } else {
                    localStorage.removeItem(PREFS_KEY);
                }
            } catch (err) {
                console.warn('Unable to store preferences', err);
            }
        };
    
    // The preferences in effect from the start; the attrs are at their defaults until a map
    // is applied.
    for (const def of PREFERENCES) applyValue(def, prefs[def.id] ?? def.defaultValue);
    
    pkg.settings = {
        // The preferences, by group, for Settings.
        getGroups: () => GROUPS,
        
        /*  A preference's value. */
        get: id => {
            const def = PREFERENCES_BY_ID.get(id);
            if (!def) console.warn('Unknown preference', id);
            return def ? prefs[id] ?? def.defaultValue : undefined;
        },
        
        /*  Sets a preference. Returns the value set, after rounding and clamping, or
            undefined if it was refused. */
        set: (id, value) => {
            const def = PREFERENCES_BY_ID.get(id),
                normalized = def ? normalize(def, value) : undefined;
            if (normalized === undefined) {
                console.warn('Preference', id, 'cannot be', value);
            } else {
                if (normalized === def.defaultValue) {
                    delete prefs[id];
                } else {
                    prefs[id] = normalized;
                }
                writePrefs();
                applyValue(def, normalized);
                pkg.app?.notifySettingChanged(id, normalized);
            }
            return normalized;
        },
        
        /*  Puts a map's attrs into effect, in place of any earlier map's: its file's
            "attrs", {id:value}; every attr it doesn't set goes back to its default. Unknown
            ids and values that can't be used are skipped with a warning. Returns the attrs
            put into effect, cleaned up, e.g. for saving with a game. */
        applyMap: attrs => {
            const clean = {};
            for (const id in attrs ?? {}) {
                const def = MAP_ATTRS_BY_ID.get(id),
                    value = def ? normalize(def, attrs[id]) : undefined;
                if (value === undefined) {
                    console.warn('Map attr', id, 'cannot be', attrs[id]);
                } else {
                    clean[id] = value;
                }
            }
            for (const def of MAP_ATTRS) applyValue(def, clean[def.id] ?? def.defaultValue);
            return clean;
        }
    };
})(hc);
