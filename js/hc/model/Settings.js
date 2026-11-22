(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            isObj,
            cfg:{AI, QUAD, VISION, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, HEAL, RANK}
        } = pkg,
        
        STORAGE_KEY = 'hc.settings',
        
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
        
        // The solid subtypes, as choices. They're known once init.json5 has loaded.
        solidOptions = () => pkg.solids.list().map(s => ({value:s.id, label:s.name})),
        
        // The hole subtypes, as choices, likewise.
        holeOptions = () => pkg.holes.list().map(h => ({value:h.id, label:h.name})),
        
        /*  Every setting. The SettingsDialog builds its UI from this list, so adding a
            setting here is enough to make it appear there (in a level that shows it). */
        DEFINITIONS = [
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
        num('lootMin',     GROUP_TILES, TILES,    'lootMin', 0, 1000),
        num('lootMax',     GROUP_TILES, TILES,    'lootMax', 0, 1000),
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
        num('timerMin',    GROUP_TILES, TILES,    'timerMin', 0, 50),
        num('timerMax',    GROUP_TILES, TILES,    'timerMax', 0, 50),
        num('harmDamage',  GROUP_TILES, TILES,    'harmDamage', 0, 10),
        
        num('healCostPer', GROUP_HEALS, RANK,     'healCostPer', 0, 100),
        num('healActPer',  GROUP_HEALS, RANK,     'healPer', 1, 20),
        num('healAmount',  GROUP_HEALS, HEAL,     'amount', 0, 20),
        num('healPer',     GROUP_HEALS, HEAL,     'per', 1, 8),
        num('healScore',   GROUP_HEALS, RANK,     'healScorePer', 0, 20)],
        
        GROUPS = [GROUP_VISION, GROUP_WAVES, GROUP_ENEMIES, GROUP_SWARM, GROUP_TILES, GROUP_HEALS].map(id => ({
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
            if (TILES.timerMax < TILES.timerMin) TILES.timerMax = TILES.timerMin;
            if (TILES.solidMax < TILES.solidMin) TILES.solidMax = TILES.solidMin;
            if (TILES.holeMax < TILES.holeMin) TILES.holeMax = TILES.holeMin;
            if (TILES.doorMax < TILES.doorMin) TILES.doorMax = TILES.doorMin;
        },
        
        /*  What the player has changed, per level: {levelId:{settingId:value}}. Only values
            that differ from the level's are kept. Unknown or invalid entries are dropped when
            read. */
        overrides = (() => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
                if (isObj(stored)) {
                    for (const levelId in stored) {
                        if (!isObj(stored[levelId])) continue;
                        for (const id in stored[levelId]) {
                            const def = DEFINITIONS_BY_ID.get(id),
                                value = def ? normalize(def, stored[levelId][id]) : undefined;
                            if (value !== undefined) (retval[levelId] ??= {})[id] = value;
                        }
                    }
                }
            } catch (err) {
                console.warn('Unable to read settings', err);
            }
            return retval;
        })(),
        
        writeOverrides = () => {
            try {
                for (const levelId in overrides) if (!Object.keys(overrides[levelId]).length) delete overrides[levelId];
                if (Object.keys(overrides).length) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (err) {
                console.warn('Unable to store settings', err);
            }
        };
    
    /*  The level being played, and its setting entries by setting id: {value, pref}. A
        level only lists the settings it changes or shows. */
    let levelId = null,
        entries = {};
    
    const
        /*  The level's value for a setting: its entry's value, or the default. */
        levelValue = def => entries[def.id]?.value ?? def.defaultValue,
        
        /*  Is the setting shown in Settings, for the player to change, in this level? */
        isShown = id => entries[id]?.pref === true,
        
        /*  The value in effect: the player's, if the level shows the setting and they've
            changed it, otherwise the level's. */
        get = id => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def) {
                console.warn('Unknown setting', id);
                return;
            }
            const mine = overrides[levelId];
            return isShown(id) && mine && id in mine ? mine[id] : levelValue(def);
        },
        
        applyAll = () => {
            for (const def of DEFINITIONS) applyValue(def, get(def.id));
        };
    
    // Start with every default in effect, until a level is applied.
    applyAll();
    
    /*  The settings. Every one belongs to the level being played: a level file's "attrs"
        gives, per setting id, {value, pref}. value (optional) is the level's value, in
        place of the default. pref (default false) shows the setting in Settings, so the
        player can change it; their changes are remembered per level. A setting a level
        doesn't list is at its default and isn't shown. */
    pkg.settings = {
        getDefinitions: () => DEFINITIONS,
        getGroups: () => GROUPS,
        getDefinition: id => DEFINITIONS_BY_ID.get(id),
        
        get,
        isShown,
        
        /*  Returns the value set, after rounding and clamping, or undefined if it was refused,
            including when the level doesn't show the setting. */
        set: (id, value) => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def || !isShown(id)) {
                console.warn('Setting', id, 'cannot be changed in this level');
                return;
            }
            const normalized = normalize(def, value);
            if (normalized === undefined) {
                console.warn('Setting', id, 'cannot be', value);
            } else {
                const mine = overrides[levelId] ??= {};
                if (normalized === levelValue(def)) {
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
        
        /*  Puts a level's settings into effect, with the player's changes for that level, in
            place of any earlier level's. attrs is the level file's "attrs". Unknown ids, and
            entries or values that can't be used, are skipped with a warning. Returns the
            entries put into effect, cleaned up, e.g. for saving with a game. */
        applyLevel: (id, attrs) => {
            levelId = id ?? null;
            entries = {};
            for (const settingId in attrs ?? {}) {
                const def = DEFINITIONS_BY_ID.get(settingId),
                    entry = attrs[settingId];
                if (!def || !isObj(entry)) {
                    console.warn('Level attr', settingId, 'cannot be', entry);
                    continue;
                }
                const clean = {pref:entry.pref === true};
                if ('value' in entry) {
                    const value = normalize(def, entry.value);
                    if (value === undefined) {
                        console.warn('Level attr', settingId, 'cannot have the value', entry.value);
                    } else {
                        clean.value = value;
                    }
                }
                entries[settingId] = clean;
            }
            applyAll();
            return structuredClone(entries);
        },
        
        /*  Puts every setting the level shows back to the level's value. */
        resetToDefaults: () => {
            delete overrides[levelId];
            writeOverrides();
            applyAll();
            pkg.app?.notifySettingChanged(null);
        }
    };
})(hc);
