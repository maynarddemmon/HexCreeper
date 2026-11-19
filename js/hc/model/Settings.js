(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            cfg:{AI, GRIDCFG, QUAD, LINK, COMBAT, ENEMY, PRESSURE, SPAWN, TILES, HEAL, RANK}
        } = pkg,
        
        STORAGE_KEY = 'hc.settings',
        
        SETTING_GRID = pkg.SETTING_GRID = 'grid',
        GRID_HEX = pkg.GRID_HEX = 'hex',
        GRID_SQUARE = pkg.GRID_SQUARE = 'square',
        
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
        
        /*  Every player setting. The SettingsDialog builds its UI from this list, so adding a
            setting here is enough to make it appear there. */
        DEFINITIONS = [{
            id:SETTING_GRID, type:'choice', options:[GRID_HEX, GRID_SQUARE], newGame:true,
            defaultValue:GRIDCFG.hex ? GRID_HEX : GRID_SQUARE, label:i18n('setting-grid')
        },
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
        
        num('advance',     GROUP_SWARM, COMBAT,   'advance', 0, 1),
        num('linkRange',   GROUP_SWARM, LINK,     'range', 1, 20),
        num('rankBase',    GROUP_SWARM, RANK,     'base', 1, 10),
        num('hpPer',       GROUP_SWARM, RANK,     'hpPer', 1, 20),
        num('movesPer',    GROUP_SWARM, RANK,     'movesPer', 1, 10),
        num('costPer',     GROUP_SWARM, RANK,     'costPer', 0, 100),
        num('rankUpHeals', GROUP_SWARM, RANK,     'rankUpHeals', 0, 1),
        
        num('hexRadius',   GROUP_TILES, GRIDCFG,  'hexRadius', 1, 6, true),
        num('quadSize',    GROUP_TILES, QUAD,     'size', 4, 40, true),
        num('healPerQuad', GROUP_TILES, TILES,    'healPerQuad', 0, 20),
        num('harmPerQuad', GROUP_TILES, TILES,    'harmPerQuad', 0, 40),
        num('timerMin',    GROUP_TILES, TILES,    'timerMin', 0, 50),
        num('timerMax',    GROUP_TILES, TILES,    'timerMax', 0, 50),
        num('harmDamage',  GROUP_TILES, TILES,    'harmDamage', 0, 10),
        
        num('healCostPer', GROUP_HEALS, RANK,     'healCostPer', 0, 100),
        num('healActPer',  GROUP_HEALS, RANK,     'healPer', 1, 20),
        num('healAmount',  GROUP_HEALS, HEAL,     'amount', 0, 20),
        num('healPer',     GROUP_HEALS, HEAL,     'per', 1, 8),
        num('healScore',   GROUP_HEALS, RANK,     'healScorePer', 0, 20)],
        
        GROUPS = [GROUP_WAVES, GROUP_ENEMIES, GROUP_SWARM, GROUP_TILES, GROUP_HEALS].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:DEFINITIONS.filter(def => def.group === id)
        })),
        
        DEFINITIONS_BY_ID = new Map(DEFINITIONS.map(def => [def.id, def])),
        
        /*  A value the setting can hold, or undefined: numbers are rounded and clamped,
            choices must be one of the options. */
        normalize = (def, value) => {
            if (def.type === 'number') {
                const n = Math.round(Number(value));
                return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, n)) : undefined;
            }
            return def.options.includes(value) ? value : undefined;
        },
        
        /*  Puts a setting's value into the tunable it controls. */
        applyValue = (def, value) => {
            if (def.type === 'number') {
                def.obj[def.prop] = value;
            } else if (def.id === SETTING_GRID) {
                GRIDCFG.hex = value === GRID_HEX ? 1 : 0;
            }
            // Keep the ranges the right way round.
            if (SPAWN.maxDist < SPAWN.minDist) SPAWN.maxDist = SPAWN.minDist;
            if (TILES.timerMax < TILES.timerMin) TILES.timerMax = TILES.timerMin;
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
    
    // Start with the stored settings in effect.
    for (const def of DEFINITIONS) applyValue(def, get(def.id));
    
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
                applyValue(def, normalized);
                pkg.app?.notifySettingChanged(id, normalized);
            }
            return normalized;
        },
        
        /*  Puts every setting except the grid back to its default. */
        resetToDefaults: () => {
            for (const def of DEFINITIONS) {
                if (def.id === SETTING_GRID) continue;
                delete overrides[def.id];
                applyValue(def, def.defaultValue);
            }
            writeOverrides(overrides);
            pkg.app?.notifySettingChanged(null);
        }
    };
})(hc);
