/*  Preferences and map rules.
    
    Preferences are the player's, for the whole app (whether pieces' moves are animated,
    the follow margin, whether the combat log shows), and stand in for hc.cfg's values. They're shown in Settings and saved in
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
        
        // The cost rules' variables: your core's level, your highest, and your pieces'
        // levels together (see Game.costRule).
        COST_VARS = pkg.COST_VARS = ['coreLevel', 'maxLevel', 'levels'],
        
        GROUP_DISPLAY = 'display',
        
        // An attr (see Attrs.js) that edits obj[prop], with obj[prop] as its default.
        onto = (obj, prop, make, id, ...rest) => ({...make(id, obj[prop], ...rest), obj, prop}),
        
        // A preference: shown in Settings, in a group, with a label (setting-<id>).
        pref = (group, def) => ({...def, group, label:i18n('setting-' + def.id)}),
        
        /*  Every preference. The SettingsDialog builds its UI from this list, so adding one
            here is enough to make it appear there. */
        PREFERENCES = [
            pref(GROUP_DISPLAY, onto(cfg.ANIM, 'on', bool, 'animate')),
            pref(GROUP_DISPLAY, onto(cfg.ANIM, 'speed', num, 'animSpeed', 25, 200)),
            pref(GROUP_DISPLAY, onto(cfg, 'FOLLOW_MARGIN', num, 'followMargin', 5, 45)),
            pref(GROUP_DISPLAY, onto(cfg, 'COMBAT_LOG', bool, 'combatLog')),
            pref(GROUP_DISPLAY, onto(cfg.SHADOW, 'on', bool, 'shadows'))
        ],
        
        GROUPS = [GROUP_DISPLAY].map(id => ({
            id, label:i18n('settings-group-' + id), definitions:PREFERENCES.filter(def => def.group === id)
        })),
        
        /*  Every map rule, with its default. A piece's rank = max(rankBase, 1 + the lower
            of its two highest-ranked children's) (a missing child counts as 0, so a piece
            needs two children to rank up). */
        RULES = [
            num('visionRadius', 12, 1, 30),   // how far your pieces see (see hc.cfg.VISION)
            num('linkRange', 3, 1, 20),       // the farthest a linked piece can get from the one it's linked to
            choice('moveMode', 'fixed', () => pkg.PLAYER_MOVE_MODES.map(m => ({value:m, label:m}))), // how your pieces move at the start: fixed or follow (see Movement.js)
            num('rankBase', 1, 1, 10),        // the rank of a piece without two children (it sets how XP is shared: see Combat.awardXp)
            // Combat and action points (see Combat.js). Their defaults are in init.json5's
            // "rules", to tune them there; these are only for if it hasn't them. Formulas of
            // a piece's level and stats (pkg.STAT_VARS), rounded down, but the hit chance,
            // of accuracy and defence, the damage roll, and action points and xp (kept in
            // hundredths).
            expr('maxHp', '10 + con / 2 + (level - 1) * (2 + con / 5)', pkg.STAT_VARS),
            expr('meleeAccuracy', 'str + level', pkg.STAT_VARS),
            expr('defence', 'agl + level', pkg.STAT_VARS),
            expr('hitChance', '50 + 3 * (accuracy - defence)', ['accuracy', 'defence']),
            num('hitMin', 5, 0, 100),
            num('hitMax', 95, 0, 100),
            expr('damageRoll', 'min + floor(roll * (max - min + 1))', pkg.DAMAGE_VARS),
            expr('damageBonus', '(str - 10) / 2', pkg.STAT_VARS),
            expr('penetrationBonus', '(str - 10) / 4', pkg.STAT_VARS),
            expr('xpToLevel', '20 * level', pkg.STAT_VARS),
            expr('xpValue', '5 * level', pkg.STAT_VARS),
            expr('parentXPShare', 'xp * rank / 20', pkg.XP_VARS),   // passed up to a piece's parent, of what it got
            expr('childXPBonus', 'xp * parentRank / 20', pkg.XP_VARS), // more for a piece with a parent
            expr('apPool', '1 + con / 10', pkg.STAT_VARS),
            expr('apRecovery', '0.5 + agl / 40', pkg.STAT_VARS),
            expr('apInitiative', '(wis + agl) / 40', pkg.STAT_VARS),
            expr('actionCost', '1', pkg.STAT_VARS),
            expr('jumpExhaustion', '2', pkg.STAT_VARS),
            expr('rallyCost', '0.5', pkg.STAT_VARS),
            expr('rallyTurns', '3', pkg.STAT_VARS),
            expr('rallyAmount', '(con / 10) * level', pkg.STAT_VARS),
            expr('rallyRefresh', 'Math.max(10, 150 - level)', pkg.STAT_VARS),
            // Costs (see Game.costRule): formulas of your levels (COST_VARS), rounded down.
            // (Not in init.json5: a map can set them, as any rule.)
            expr('placeCost', '4 + ceil(levels / 2)', COST_VARS),   // to place a piece
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
    
    // The rules' defaults: init.json5's (see setDefaultRules), else the ones above.
    let defaultRules = resolve(RULES, undefined, '');
    
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
        
        /*  Sets the rules' defaults from init.json5's "rules" (those it has, made usable as
            cleanRules does), over the ones here. */
        setDefaultRules: rules => {
            defaultRules = {...resolve(RULES, undefined, ''), ...resolve(RULES, rules, 'init.json5 rules', true)};
        },
        
        /*  Every rule, {id:value}: those given, made usable as cleanRules does, and the
            rest at their defaults (see setDefaultRules). */
        resolveRules: (rules, where) => ({...defaultRules, ...resolve(RULES, rules, where + ' rules', true)})
    };
})(hc);
