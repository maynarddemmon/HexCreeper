/*  Needs: thirst, hunger and fatigue (NEEDS; a module included in Game).

    Your pieces (only theirs, for now) each have a value for each need (piece.needs,
    {need:value}, saved), kept in hundredths of a point (NEED_UNIT), from its min to its
    max, starting at its upper. Its bounds are rules of the piece's level and stats (its
    own: not what its needs make them), so a tougher piece lasts longer: for thirst,
    minThirst, lowerThirst, upperThirst and maxThirst (0, 25, 75 and 100, times con / 10).
    If they change, the value keeps its place between its min and max (see rescaleNeeds).

    Each goes down (its ticks are added: they're below 0) at the end of every turn
    (thirstTurnTick: housekeeping, before action points come back) and for every action
    point a piece spends (thirstApTick, times the points: see Combat.spend). Drinking
    raises thirst and eating hunger (an item's quench and satiates: see Items.js); fatigue
    will come down with rest, later.

    A need is low at or below its lower, high above its upper, and in between does
    nothing. Low or high it adds to:
        recovery  the action points the piece gets back each turn (thirstLowRecovery,
                  thirstHighRecovery)
        HP        its HP each turn, at the end of the turn (thirstLowHp, thirstHighHp):
                  fractions carry over (piece.hpCarry, in hundredths), and HP lost this
                  way can kill it
        stats     each of its stats (thirstLowStats, thirstHighStats: see statVars)
    At its min, what it does low is its MinMultiplier (thirstMinMultiplier, 2) times as
    much. By default thirst does recovery, hunger HP, and fatigue (for now) nothing. */
(pkg => {
    'use strict';
    
    const {I18N:{get:i18n}} = myt,
        {
            isObj, attrs:{evaluate},
            STATS, STAT_VARS, NEEDS, NEED_UNIT, AP_UNIT
        } = pkg,
        
        // A need's name as it is in its rules' names: "Thirst"
        cap = need => need[0].toUpperCase() + need.slice(1),
        
        LEVELS = ['min', 'low', 'mid', 'high']; // what a need's value can make it (see needLevel)
    
    pkg.Needs = new JS.Module('Needs', {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            LEVELS,
            
            /*  Whether a piece's needs as saved make sense: undefined (it has none), or a
                whole number for each need. */
            isNeeds: v => v === undefined || (isObj(v) && NEEDS.every(n => Number.isInteger(v[n])))
        },
        
        // ---- Rules ----
        /*  What a need rule's formula comes to for piece p, in points: of its level and its
            own stats. */
        needRule: function(rule, p) {
            return evaluate(this.rules[rule], STAT_VARS, {level:p.level, ...p.stats}) || 0;
        },
        
        /*  Need's bounds for piece p, in hundredths: {min, lower, upper, max}, in that
            order (each at least the one before). */
        needBounds: function(p, need) {
            const at = id => Math.round(NEED_UNIT * this.needRule(id + cap(need), p)),
                min = at('min'),
                lower = Math.max(min, at('lower')),
                upper = Math.max(lower, at('upper'));
            return {min, lower, upper, max:Math.max(upper, at('max'))};
        },
        
        // ---- A piece's needs ----
        /*  Every need's bounds for piece p: {need:{min, lower, upper, max}}, or null if it
            has no needs. */
        needsBounds: function(p) {
            return p.needs ? Object.fromEntries(NEEDS.map(n => [n, this.needBounds(p, n)])) : null;
        },
        
        /*  Piece p's bounds were was (see needsBounds) and have changed (its con has): each
            of its needs keeps where it was between its min and max (a thirst half full
            stays half full). */
        rescaleNeeds: function(p, was) {
            if (p.needs && was) {
                for (const n of NEEDS) {
                    const before = was[n], after = this.needBounds(p, n),
                        span = before.max - before.min,
                        part = span > 0 ? (Math.min(before.max, Math.max(before.min, p.needs[n])) - before.min) / span : 1;
                    p.needs[n] = Math.round(after.min + part * (after.max - after.min));
                }
            }
        },
        
        /*  Piece p (one of yours) gets its needs, each at its upper. */
        giveNeeds: function(p) {
            p.needs = Object.fromEntries(NEEDS.map(n => [n, this.needBounds(p, n).upper]));
            p.hpCarry = 0;
        },
        
        /*  Need's value for piece p, in hundredths, kept within its bounds; or null if it
            has no needs. */
        needValue: function(p, need) {
            const v = p.needs?.[need];
            if (v == null) return null;
            const {min, max} = this.needBounds(p, need);
            return Math.min(max, Math.max(min, v));
        },
        
        /*  Need's level for piece p: 'min' (at its min), 'low' (at or below its lower),
            'high' (above its upper) or 'mid'; or null if it has no needs. */
        needLevel: function(p, need) {
            const v = this.needValue(p, need);
            let retval = null;
            if (v != null) {
                const {min, lower, upper} = this.needBounds(p, need);
                retval = v <= min ? 'min' : v <= lower ? 'low' : v > upper ? 'high' : 'mid';
            }
            return retval;
        },
        
        /*  What need does to what (Recovery, Hp or Stats) for piece p now, in points (see
            above): 0 in the middle, or without needs. */
        needEffect: function(p, need, what) {
            const level = this.needLevel(p, need);
            let retval = 0;
            if (level === 'high') {
                retval = this.needRule(need + 'High' + what, p);
            } else if (level === 'low' || level === 'min') {
                retval = this.needRule(need + 'Low' + what, p) * (level === 'min' ? this.needRule(need + 'MinMultiplier', p) : 1);
            }
            return retval;
        },
        
        /*  What all piece p's needs do to what (Recovery, Hp or Stats), in points. */
        needsEffect: function(p, what) {
            return p.needs ? NEEDS.reduce((n, need) => n + this.needEffect(p, need, what), 0) : 0;
        },
        
        /*  Piece p's need changes by delta (hundredths), kept within its bounds. */
        changeNeed: function(p, need, delta) {
            if (p.needs) {
                const {min, max} = this.needBounds(p, need);
                p.needs[need] = Math.min(max, Math.max(min, this.needValue(p, need) + Math.round(delta)));
            }
        },
        
        /*  The words for piece p's needs that aren't in the middle (e.g. "Parched,
            Sated"). */
        needWords: function(p) {
            return NEEDS.map(n => ({n, level:this.needLevel(p, n)})).filter(({level}) => level && level !== 'mid')
                .map(({n, level}) => i18n('need-' + n + '-' + level)).join(', ');
        },
        
        // ---- Stats ----
        /*  The vars for piece p's stat rules: its level, and its stats with what its needs
            add (each rounded, and not below 0). */
        statVars: function(p) {
            const add = this.needsEffect(p, 'Stats'),
                vars = {level:p.level};
            for (const s of STATS) vars[s] = add ? Math.max(0, Math.round(p.stats[s] + add)) : p.stats[s];
            return vars;
        },
        
        // ---- Over time ----
        /*  Piece p has spent cost action points (hundredths): each of its needs goes by its
            ApTick for each point. */
        needsSpend: function(p, cost) {
            for (const n of NEEDS) this.changeNeed(p, n, NEED_UNIT * this.needRule(n + 'ApTick', p) * cost / AP_UNIT);
        },
        
        /*  Housekeeping: each of your pieces' needs goes by its TurnTick, then what they do
            to its HP (see changeHp). */
        tickNeeds: function() {
            for (const p of [...this.pieces.values()]) {
                if (p.needs && this.pieces.has(p.id) && !this.over) {
                    for (const n of NEEDS) this.changeNeed(p, n, NEED_UNIT * this.needRule(n + 'TurnTick', p));
                    this.changeHp(p, this.needsEffect(p, 'Hp'));
                }
            }
        },
        
        /*  Piece p's HP changes by delta points: whole points of it now (gained up to its
            max; lost as damage, which can kill it), the rest carried over to the next
            change (piece.hpCarry, in hundredths). */
        changeHp: function(p, delta) {
            const d = Math.round(100 * delta);
            if (d > 0 && p.hp >= p.maxHp) {
                p.hpCarry = 0;
            } else if (d) {
                const carry = (p.hpCarry ?? 0) + d,
                    whole = Math.trunc(carry / 100);
                p.hpCarry = carry - whole * 100;
                if (whole > 0) {
                    const n = Math.min(whole, p.maxHp - p.hp);
                    p.hp += n;
                    if (n) this.fx(p.x, p.y, `+${n} HP`, '--heal', {});
                } else if (whole < 0) {
                    this.damage(p, -whole);
                }
            }
        }
    });
})(hc);
