(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
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
        
        /*  Every player setting. The SettingsDialog builds its UI from this list, so adding a
            setting here is enough to make it appear there. */
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
        num('rankBase',    GROUP_SWARM, RANK,     'base', 1, 10),
        num('hpPer',       GROUP_SWARM, RANK,     'hpPer', 1, 20),
        num('movesPer',    GROUP_SWARM, RANK,     'movesPer', 1, 10),
        num('costPer',     GROUP_SWARM, RANK,     'costPer', 0, 100),
        bool('rankUpHeals', GROUP_SWARM, RANK,    'rankUpHeals'),
        
        num('quadRadius',  GROUP_TILES, QUAD,     'radius', 1, 6, true),
        num('healPerQuad', GROUP_TILES, TILES,    'healPerQuad', 0, 20),
        num('harmPerQuad', GROUP_TILES, TILES,    'harmPerQuad', 0, 40),
        num('wallChance',  GROUP_TILES, TILES,    'wallChance', 0, 100),
        num('wallHoleChance', GROUP_TILES, TILES, 'wallHoleChance', 0, 100),
        num('doorMin',     GROUP_TILES, TILES,    'doorMin', 0, 10),
        num('doorMax',     GROUP_TILES, TILES,    'doorMax', 0, 10),
        num('solidMin',    GROUP_TILES, TILES,    'solidMin', 0, 20),
        num('solidMax',    GROUP_TILES, TILES,    'solidMax', 0, 20),
        num('holeMin',     GROUP_TILES, TILES,    'holeMin', 0, 20),
        num('holeMax',     GROUP_TILES, TILES,    'holeMax', 0, 20),
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
        
        /*  A value the setting can hold, or undefined: booleans must be booleans, and
            numbers are rounded and clamped. */
        normalize = (def, value) => {
            if (def.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
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
        
        writeOverrides = overrides => {
            try {
                if (Object.keys(overrides).length > 0) {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
                } else {
                    localStorage.removeItem(STORAGE_KEY);
                }
            } catch (err) {
                console.warn('Unable to store settings', err);
            }
        },
        
        /*  Unknown or invalid entries, and ones equal to their default, are dropped. */
        overrides = (() => {
            const retval = {};
            try {
                const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
                if (stored && typeof stored === 'object') {
                    for (const id in stored) {
                        const def = DEFINITIONS_BY_ID.get(id),
                            value = def ? normalize(def, stored[id]) : undefined;
                        if (value !== undefined && value !== def.defaultValue) retval[id] = value;
                    }
                }
            } catch (err) {
                console.warn('Unable to read settings', err);
            }
            return retval;
        })(),
        
        get = id => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (def) return id in overrides ? overrides[id] : def.defaultValue;
            console.warn('Unknown setting', id);
        };
    
    /*  The values the level being played sets, by setting id. For now a level sets values
        with the same ids as the settings, and they win over the stored settings. */
    let levelAttrs = {};
    
    /*  The value in effect: the level's if it sets one, otherwise the stored setting. */
    const effective = id => id in levelAttrs ? levelAttrs[id] : get(id);
    
    // Start with the stored settings in effect.
    for (const def of DEFINITIONS) applyValue(def, effective(def.id));
    
    pkg.settings = {
        getDefinitions: () => DEFINITIONS,
        getGroups: () => GROUPS,
        getDefinition: id => DEFINITIONS_BY_ID.get(id),
        
        get,
        
        /*  Returns the value set, after rounding and clamping, or undefined if it was refused. */
        set: (id, value) => {
            const def = DEFINITIONS_BY_ID.get(id);
            if (!def) {
                console.warn('Unknown setting', id);
                return;
            }
            const normalized = normalize(def, value);
            if (normalized === undefined) {
                console.warn('Setting', id, 'cannot be', value);
            } else {
                if (normalized === def.defaultValue) {
                    delete overrides[id];
                } else {
                    overrides[id] = normalized;
                }
                writeOverrides(overrides);
                applyValue(def, effective(id));
                pkg.app?.notifySettingChanged(id, normalized);
            }
            return normalized;
        },
        
        /*  Puts a level's values into effect, in place of any earlier level's. attrs maps
            setting ids to values; unknown ids and values that can't be used are skipped with
            a warning. Returns the values put into effect, after rounding and clamping. */
        applyLevel: attrs => {
            levelAttrs = {};
            for (const id in attrs ?? {}) {
                const def = DEFINITIONS_BY_ID.get(id),
                    value = def ? normalize(def, attrs[id]) : undefined;
                if (value === undefined) {
                    console.warn('Level attr', id, 'cannot be', attrs[id]);
                } else {
                    levelAttrs[id] = value;
                }
            }
            for (const def of DEFINITIONS) applyValue(def, effective(def.id));
            return {...levelAttrs};
        },
        
        /*  Puts every setting back to its default. */
        resetToDefaults: () => {
            for (const def of DEFINITIONS) {
                delete overrides[def.id];
                applyValue(def, effective(def.id));
            }
            writeOverrides(overrides);
            pkg.app?.notifySettingChanged(null);
        }
    };
})(hc);
