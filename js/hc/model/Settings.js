/*  Preferences and map rules.
    
    Preferences are the player's, for the whole app (so far only whether pieces' moves are
    animated), and stand in for hc.cfg's values. They're shown in Settings and saved in
    the browser (hc.prefs, {id:value}, only those changed from the default).
    
    Map rules are gameplay values, with their defaults here (RULES), that a map can set:
    its file's "rules", {id:value}. A game has all of them, its map's over the defaults, in
    game.rules. They're never shown to the player. (They're tuned in code, or by a map for
    some special effect of its own.) What a map's tiles and enemies are like is up to its
    components' attrs instead (see MapComponent.js). */
(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        
        {
            isObj,
            attrs:{num, bool, choice, expr, normalize, resolve},
            cfg
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
            pref(GROUP_DISPLAY, onto(cfg.ANIM, 'on', bool, 'animate')),
            pref(GROUP_DISPLAY, onto(cfg, 'FOLLOW_MARGIN', num, 'followMargin', 5, 45))
        ],
        
        GROUPS = [GROUP_DISPLAY].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:PREFERENCES.filter(def => def.group === id)
        })),
        
        /*  Every map rule, with its default. A piece's rank = max(rankBase, 1 + the lower
            of its two highest-ranked children's) (a missing child counts as 0, so a piece
            needs two children to rank up). */
        RULES = [
            num('visionRadius', 12, 1, 30),   // how far your pieces see (see hc.cfg.VISION)
            bool('advance', true),            // after a kill, the attacker (with its group) steps into the attacked cell if the whole group can (not onto harm)
            num('linkRange', 3, 1, 20),       // the farthest a linked piece can get from the one it's linked to
            choice('moveMode', 'fixed', () => pkg.PLAYER_MOVE_MODES.map(m => ({value:m, label:m}))), // how your pieces move at the start: fixed or follow (see Movement.js)
            num('rankBase', 1, 1, 10),        // the rank of a piece without two children (rank isn't used for now: see Combat.js)
            num('movesPer', 1, 1, 10),        // pieces you may move per turn = this x the highest rank of any piece
            // Combat (see Combat.js): formulas of a piece's level and stats (pkg.STAT_VARS),
            // rounded down, but the hit chance, of accuracy and defence.
            expr('maxHp', '10 + con / 2 + (level - 1) * (2 + con / 5)', pkg.STAT_VARS), // unless its profile fixes it
            expr('meleeAccuracy', 'str + level', pkg.STAT_VARS),
            expr('defence', 'agl + level', pkg.STAT_VARS),
            expr('hitChance', '50 + 3 * (accuracy - defence)', ['accuracy', 'defence']), // in %, kept from hitMin to hitMax
            num('hitMin', 5, 0, 100),
            num('hitMax', 95, 0, 100),
            expr('damageBonus', '(str - 10) / 2', pkg.STAT_VARS),     // added to the weapon's damage (never below 0)
            expr('penetrationBonus', '(str - 10) / 4', pkg.STAT_VARS), // added to the weapon's penetration (if more than 0)
            expr('xpToLevel', '20 * level', pkg.STAT_VARS),            // the xp to go up from this level
            num('placeBase', 4, 0, 100),      // the cost to place a piece = this + 1 per placePerPieces of your pieces' levels (rounded up)
            num('placePerPieces', 2, 1, 100),
            num('healCostPer', 5, 0, 100),    // the Heal action costs this x your core's level
            num('healActPer', 4, 1, 20),      // and heals this x your core's level
            num('healScore', 1, 0, 20),       // each unused heal point becomes this much score
            num('corePathLength', 250, 0, 100000) // how many of the core's latest steps the golden path keeps (0: none)
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
    
    // The preferences in effect from the start.
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
        
        /*  Every rule, {id:value}: those given, made usable as cleanRules does, and the
            rest at their defaults. */
        resolveRules: (rules, where) => resolve(RULES, rules, where + ' rules')
    };
})(hc);
