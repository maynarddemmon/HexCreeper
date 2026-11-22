(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            isObj,
            cfg:{AI, QUAD, VISION, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, RANK, ANIM}
        } = pkg,
        
        STORAGE_KEY = 'hc.settings',
        PREFS_KEY = 'hc.prefs',
        
        GROUP_DISPLAY = 'display',
        GROUP_VISION = 'vision',
        GROUP_WAVES = 'waves',
        GROUP_ENEMIES = 'enemies',
        GROUP_SWARM = 'swarm',
        GROUP_TILES = 'tiles',
        GROUP_HEALS = 'heals',
        
        // Each number setting edits obj[prop]. newGame: it only matters from the next game.
        num = (id, group, obj, prop, min, max, newGame=false) => ({
            id, type:'number', group, obj, prop, min, max, newGame,
            defaultValue:obj[prop], label:i18n('setting-' + id)
        }),
        
        // Each boolean setting edits obj[prop] too, and is shown as a checkbox.
        bool = (id, group, obj, prop) => ({
            id, type:'boolean', group, obj, prop,
            defaultValue:obj[prop], label:i18n('setting-' + id)
        }),
        
        // Each choice setting edits obj[prop] too, and holds one of the values options()
        // gives: [{value, label}]. It's shown as a drop-down list.
        choice = (id, group, obj, prop, options) => ({
            id, type:'choice', group, obj, prop, options,
            defaultValue:obj[prop], label:i18n('setting-' + id)
        }),
        
        // A preference: a setting for the whole app, not a map. It's always in Settings
        // (not in a map's brief), maps can't change it, it's kept once for every map,
        // and Reset to Defaults leaves it alone.
        pref = def => ({...def, app:true}),
        
        // A set of subtypes (solids, holes, heals...), as choices. They're known once
        // init.json5 has loaded.
        optionsOf = subtypes => () => subtypes.list().map(s => ({value:s.id, label:s.name})),
        solidOptions = optionsOf(pkg.solids),
        holeOptions = optionsOf(pkg.holes),
        
        /*  Every setting. The SettingsDialog builds its UI from this list, so adding a
            setting here is enough to make it appear there (in a map that shows it). */
        DEFINITIONS = [
        pref(bool('animate', GROUP_DISPLAY, ANIM, 'on')),
        
        bool('fog',        GROUP_VISION, VISION,  'fog'),
        num('visionRadius', GROUP_VISION, VISION, 'radius', 1, 30),
        
        num('spawnEvery',  GROUP_WAVES, SPAWN,    'every', 1, 50),
        num('pBase',       GROUP_WAVES, PRESSURE, 'base', 0, 50),
        num('pPerRank',    GROUP_WAVES, PRESSURE, 'perRank', 0, 20),
        num('pSquadExtra', GROUP_WAVES, PRESSURE, 'squadExtra', 0, 10),
        num('pTime',       GROUP_WAVES, PRESSURE, 'timeEvery', 0, 500),
        num('initial',     GROUP_WAVES, SPAWN,    'initial', 0, 50),
        num('minDist',     GROUP_WAVES, SPAWN,    'minDist', 2, 40),
        num('maxDist',     GROUP_WAVES, SPAWN,    'maxDist', 2, 40),
        
        num('aiExpose',    GROUP_ENEMIES, AI,     'expose', 0, 50),
        num('aiPatience',  GROUP_ENEMIES, AI,     'patience', 1, 20),
        num('enemyHpPer',  GROUP_ENEMIES, ENEMY,  'hpPer', 1, 20),
        num('maxSquad',    GROUP_ENEMIES, ENEMY,  'maxSquad', 1, 31),
        
        bool('advance',    GROUP_SWARM, COMBAT,   'advance'),
        num('linkRange',   GROUP_SWARM, LINK,     'range', 1, 20),
        choice('moveMode', GROUP_SWARM, LINK,     'mode', () => pkg.MOVE_MODES.map(m => ({value:m, label:i18n('mode-' + m)}))),
        num('rankBase',    GROUP_SWARM, RANK,     'base', 1, 10),
        num('hpPer',       GROUP_SWARM, RANK,     'hpPer', 1, 20),
        num('movesPer',    GROUP_SWARM, RANK,     'movesPer', 1, 10),
        num('placeBase',   GROUP_SWARM, RANK,     'placeBase', 0, 100),
        num('placePerPieces', GROUP_SWARM, RANK,  'placePerPieces', 1, 100),
        bool('rankUpHeals', GROUP_SWARM, RANK,    'rankUpHeals'),
        
        num('quadRadius',  GROUP_TILES, QUAD,     'radius', 1, 6, true),
        num('healPerQuad', GROUP_TILES, TILES,    'healPerQuad', 0, 20),
        num('harmPerQuad', GROUP_TILES, TILES,    'harmPerQuad', 0, 40),
        num('lootChance',  GROUP_TILES, TILES,    'lootChance', 0, 100),
        choice('healType', GROUP_TILES, TILES,    'healType', optionsOf(pkg.heals)),
        choice('harmType', GROUP_TILES, TILES,    'harmType', optionsOf(pkg.harms)),
        choice('lootType', GROUP_TILES, TILES,    'lootType', optionsOf(pkg.loots)),
        num('wallChance',  GROUP_TILES, TILES,    'wallChance', 0, 100),
        num('wallHoleChance', GROUP_TILES, TILES, 'wallHoleChance', 0, 100),
        num('doorMin',     GROUP_TILES, TILES,    'doorMin', 0, 10),
        num('doorMax',     GROUP_TILES, TILES,    'doorMax', 0, 10),
        num('solidMin',    GROUP_TILES, TILES,    'solidMin', 0, 20),
        num('solidMax',    GROUP_TILES, TILES,    'solidMax', 0, 20),
        num('holeMin',     GROUP_TILES, TILES,    'holeMin', 0, 20),
        num('holeMax',     GROUP_TILES, TILES,    'holeMax', 0, 20),
        choice('wallSolid', GROUP_TILES, TILES,   'wallSolid', solidOptions),
        choice('clumpSolid', GROUP_TILES, TILES,  'clumpSolid', solidOptions),
        choice('wallHole', GROUP_TILES, TILES,    'wallHole', holeOptions),
        choice('clumpHole', GROUP_TILES, TILES,   'clumpHole', holeOptions),
        
        num('healCostPer', GROUP_HEALS, RANK,     'healCostPer', 0, 100),
        num('healActPer',  GROUP_HEALS, RANK,     'healPer', 1, 20),
        num('healScore',   GROUP_HEALS, RANK,     'healScorePer', 0, 20)],
        
        GROUPS = [GROUP_DISPLAY, GROUP_VISION, GROUP_WAVES, GROUP_ENEMIES, GROUP_SWARM, GROUP_TILES, GROUP_HEALS].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:DEFINITIONS.filter(def => def.group === id)
        })),
        
        DEFINITIONS_BY_ID = new Map(DEFINITIONS.map(def => [def.id, def])),
        
        /*  A value the setting can hold, or undefined: booleans must be booleans, choices
            one of the options (any text, before the options are known), and numbers are
            rounded and clamped. */
        normalize = (def, value) => {
            if (def.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
            if (def.type === 'choice') {
                const options = def.options();
                return typeof value === 'string' && (!options.length || options.some(o => o.value === value)) ? value : undefined;
            }
            const n = Math.round(Number(value));
            return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : undefined;
        },
        
        /*  Puts a setting's value into the tunable it controls. */
        applyValue = (def, value) => {
            def.obj[def.prop] = value;
            // Keep the ranges the right way round.
            if (SPAWN.maxDist < SPAWN.minDist) SPAWN.maxDist = SPAWN.minDist;
            if (TILES.solidMax < TILES.solidMin) TILES.solidMax = TILES.solidMin;
            if (TILES.holeMax < TILES.holeMin) TILES.holeMax = TILES.holeMin;
            if (TILES.doorMax < TILES.doorMin) TILES.doorMax = TILES.doorMin;
        },
        
        /*  What the player has changed, per map: {mapId:{settingId:value}}. Only values
            that differ from the map's are kept. Unknown or invalid entries are dropped when
            read. */
        overrides = (() => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
                if (isObj(stored)) {
                    for (const mapId in stored) {
                        if (!isObj(stored[mapId])) continue;
                        for (const id in stored[mapId]) {
                            const def = DEFINITIONS_BY_ID.get(id),
                                value = def ? normalize(def, stored[mapId][id]) : undefined;
                            if (value !== undefined) (retval[mapId] ??= {})[id] = value;
                        }
                    }
                }
            } catch (err) {
                console.warn('Unable to read settings', err);
            }
            return retval;
        })(),
        
        /*  The preferences the player has changed: {settingId:value}, for every map. */
        prefs = (() => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(PREFS_KEY));
                if (isObj(stored)) {
                    for (const id in stored) {
                        const def = DEFINITIONS_BY_ID.get(id),
                            value = def?.app ? normalize(def, stored[id]) : undefined;
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
        },
        
        writeOverrides = () => {
            try {
                for (const mapId in overrides) if (!Object.keys(overrides[mapId]).length) delete overrides[mapId];
                if (Object.keys(overrides).length) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (err) {
                console.warn('Unable to store settings', err);
            }
        };
    
    /*  The map being played, and its setting entries by setting id: {value, pref}. A
        map only lists the settings it changes or shows. */
    let mapId = null,
        entries = {};
    
    const
        /*  The map's value for a setting: its entry's value, or the default. */
        mapValue = def => entries[def.id]?.value ?? def.defaultValue,
        
        /*  Is the setting shown in Settings, for the player to change, in this map? */
        isShown = id => entries[id]?.pref === true,
        
        /*  The value in effect: the player's, if the map shows the setting and they've
            changed it, otherwise the map's. A preference's is the player's, or its default. */
        get = id => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def) {
                console.warn('Unknown setting', id);
                return;
            }
            const mine = overrides[mapId];
            return def.app ? prefs[id] ?? def.defaultValue : isShown(id) && mine && id in mine ? mine[id] : mapValue(def);
        },
        
        applyAll = () => {
            for (const def of DEFINITIONS) applyValue(def, get(def.id));
        };
    
    // Start with every default in effect, until a map is applied.
    applyAll();
    
    /*  The settings. Every one belongs to the map being played: a map file's "attrs"
        gives, per setting id, {value, pref}. value (optional) is the map's value, in
        place of the default. pref (default false) shows the setting in Settings, so the
        player can change it; their changes are remembered per map. A setting a map
        doesn't list is at its default and isn't shown. */
    pkg.settings = {
        getDefinitions: () => DEFINITIONS,
        getGroups: () => GROUPS,
        getDefinition: id => DEFINITIONS_BY_ID.get(id),
        
        get,
        isShown,
        
        /*  Returns the value set, after rounding and clamping, or undefined if it was refused,
            including when the map doesn't show the setting. A preference can always be set. */
        set: (id, value) => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def || !(def.app || isShown(id))) {
                console.warn('Setting', id, 'cannot be changed in this map');
                return;
            }
            const normalized = normalize(def, value);
            if (normalized === undefined) {
                console.warn('Setting', id, 'cannot be', value);
            } else if (def.app) {
                if (normalized === def.defaultValue) {
                    delete prefs[id];
                } else {
                    prefs[id] = normalized;
                }
                writePrefs();
                applyValue(def, normalized);
                pkg.app?.notifySettingChanged(id, normalized);
            } else {
                const mine = overrides[mapId] ??= {};
                if (normalized === mapValue(def)) {
                    delete mine[id];
                } else {
                    mine[id] = normalized;
                }
                writeOverrides();
                applyValue(def, get(id));
                pkg.app?.notifySettingChanged(id, normalized);
            }
            return normalized;
        },
        
        /*  Puts a map's settings into effect, with the player's changes for that map, in
            place of any earlier map's. attrs is the map file's "attrs". Unknown ids, and
            entries or values that can't be used, are skipped with a warning. Returns the
            entries put into effect, cleaned up, e.g. for saving with a game. */
        applyMap: (id, attrs) => {
            mapId = id ?? null;
            entries = {};
            for (const settingId in attrs ?? {}) {
                const def = DEFINITIONS_BY_ID.get(settingId),
                    entry = attrs[settingId];
                if (!def || def.app || !isObj(entry)) {
                    console.warn('Map attr', settingId, 'cannot be', entry);
                    continue;
                }
                const clean = {pref:entry.pref === true};
                if ('value' in entry) {
                    const value = normalize(def, entry.value);
                    if (value === undefined) {
                        console.warn('Map attr', settingId, 'cannot have the value', entry.value);
                    } else {
                        clean.value = value;
                    }
                }
                entries[settingId] = clean;
            }
            applyAll();
            return structuredClone(entries);
        },
        
        /*  Puts every setting the map shows back to the map's value. */
        resetToDefaults: () => {
            delete overrides[mapId];
            writeOverrides();
            applyAll();
            pkg.app?.notifySettingChanged(null);
        }
    };
})(hc);
