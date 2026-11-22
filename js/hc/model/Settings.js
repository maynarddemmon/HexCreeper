/*  Preferences and map rules: the two kinds of value that can stand in for hc.cfg's.
    
    Preferences are the player's, for the whole app (so far only whether pieces' moves are
    animated). They're shown in Settings and saved in the browser (hc.prefs, {id:value},
    only those changed from the default).
    
    Map rules are gameplay values a map sets in place of hc.cfg's defaults: its file's
    "rules", {id:value}. They're never shown to the player, and anything a map doesn't set
    is at its default. (They're tuned in code, or by a map for some special effect of its
    own.) What a map's tiles and enemies are like is up to its generators' attrs instead
    (see Generators.js). */
(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            isObj,
            attrs:{num, bool, choice, normalize, resolve},
            cfg:{VISION, LINK, COMBAT, RANK, ANIM}
        } = pkg,
        
        PREFS_KEY = 'hc.prefs',
        
        GROUP_DISPLAY = 'display',
        
        // An attr (see Attrs.js) that edits obj[prop], with obj[prop] as its default.
        onto = (obj, prop, make, id, ...rest) => ({...make(id, obj[prop], ...rest), obj, prop}),
        
        // A preference: shown in Settings, in a group, with a label (setting-<id>).
        pref = (group, def) => ({...def, group, label:i18n('setting-' + def.id)}),
        
        /*  Every preference. The SettingsDialog builds its UI from this list, so adding one
            here is enough to make it appear there. */
        PREFERENCES = [
            pref(GROUP_DISPLAY, onto(ANIM, 'on', bool, 'animate'))
        ],
        
        GROUPS = [GROUP_DISPLAY].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:PREFERENCES.filter(def => def.group === id)
        })),
        
        /*  Every map rule. */
        RULES = [
            onto(VISION, 'radius',       num,    'visionRadius', 1, 30),   // how far your pieces see
            onto(COMBAT, 'advance',      bool,   'advance'),               // advance after a kill
            onto(LINK,   'range',        num,    'linkRange', 1, 20),
            onto(LINK,   'mode',         choice, 'moveMode', () => pkg.MOVE_MODES.map(m => ({value:m, label:m}))), // at the start of a game
            onto(RANK,   'base',         num,    'rankBase', 1, 10),
            onto(RANK,   'hpPer',        num,    'hpPer', 1, 20),          // max HP per rank
            onto(RANK,   'enemyHpPer',   num,    'enemyHpPer', 1, 20),     // enemy max HP per rank
            onto(RANK,   'movesPer',     num,    'movesPer', 1, 10),       // moves per turn per top rank
            onto(RANK,   'placeBase',    num,    'placeBase', 0, 100),     // place cost, base
            onto(RANK,   'placePerPieces', num,  'placePerPieces', 1, 100), // place cost: +1 per this many pieces
            onto(RANK,   'rankUpHeals',  bool,   'rankUpHeals'),           // ranking up adds HP too
            onto(RANK,   'healCostPer',  num,    'healCostPer', 0, 100),   // Heal action cost per core rank
            onto(RANK,   'healPer',      num,    'healActPer', 1, 20),     // Heal action HP per core rank
            onto(RANK,   'healScorePer', num,    'healScore', 0, 20)       // unused heal: score per point
        ],
        
        PREFERENCES_BY_ID = new Map(PREFERENCES.map(def => [def.id, def])),
        
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
    
    // The preferences in effect from the start; the rules are at their defaults until a map
    // is applied.
    for (const def of PREFERENCES) def.obj[def.prop] = prefs[def.id] ?? def.defaultValue;
    
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
                def.obj[def.prop] = normalized;
                pkg.app?.notifySettingChanged(id, normalized);
            }
            return normalized;
        },
        
        /*  A map's rules, {id:value}, made usable: only those given, with any that can't be
            used skipped with a warning saying where (e.g. "Map warrens"). */
        cleanRules: (rules, where) => resolve(RULES, rules, where + ' rules', true),
        
        /*  Puts a map's rules (cleaned) into effect, in place of any earlier map's: every
            rule it doesn't set goes back to its default. */
        applyRules: rules => {
            for (const def of RULES) def.obj[def.prop] = rules?.[def.id] ?? def.defaultValue;
        }
    };
})(hc);
