/*  Status effects: what a piece is going through for a while (a module included in
    Game). Their kinds, from data/init.json5's "effects" (see Subtypes.js): a name and a
    description, to show. What each does is the game's, by its id:
        exhausted   gets no action points back at the end of the turn (see Combat.js). A
                    jump exhausts a piece for the jumpExhaustion rule's turns.

    A piece's effects are plain data, saved with it: piece.effects, [{id, countdown}].
    countdown is how many more turns it lasts: at the end of each turn (housekeeping, after
    action points come back) it goes down by 1, and the effect ends at 0. Getting an effect
    a piece already has adds to its countdown (so two jumps exhaust a piece for two turns).
    Other ways for an effect to end (a save, say) would be other properties beside id. */
(pkg => {
    'use strict';

    const {Subtypes} = pkg,
        isEffect = e => typeof e?.id === 'string' && Number.isInteger(e.countdown) && e.countdown > 0;

    pkg.EFFECT_EXHAUSTED = 'exhausted';
    pkg.effects = new Subtypes('effect', () => ({}));

    pkg.Effects = new JS.Module('Effects', {
        /*  Piece p's effect id ({id, countdown}), or undefined if it hasn't it. */
        effectOn: function(p, id) {return p.effects?.find(e => e.id === id);},

        /*  Piece p gets effect id for turns more turns (none if turns is under 1). */
        addEffect: function(p, id, turns) {
            if (turns >= 1) {
                const e = this.effectOn(p, id);
                if (e) {
                    e.countdown += turns;
                } else {
                    (p.effects ??= []).push({id, countdown:turns});
                }
            }
        },

        /*  Housekeeping: every piece's effects count down a turn, and end at 0. */
        tickEffects: function() {
            for (const p of this.pieces.values()) {
                if (p.effects?.length) p.effects = p.effects.filter(e => --e.countdown > 0);
            }
        },

        /*  Piece p's effects as loaded from a save: those that make sense, or [] (from before
            effects, none). */
        loadedEffects: function(p) {
            return Array.isArray(p.effects) ? p.effects.filter(isEffect).map(e => ({id:e.id, countdown:e.countdown})) : [];
        }
    });
})(hc);
