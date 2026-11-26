/*  Status effects: what a piece is going through for a while (a module included in
    Game). Their kinds, from data/init.json5's "effects" (see Subtypes.js): a name and a
    description, to show, and an icon, drawn above a piece that has it (one of img/icons',
    by name: see Render.js). A "muted" one has no icon drawn, but shows in the character
    sheet and when you point at an enemy (for long-lasting things: curses, diseases,
    crippling wounds); a "hidden" one shows nowhere (for the game's own bookkeeping). What
    each does is the game's, by its id:
        exhausted   gets no action points back at the end of the turn (see Combat.js). A
                    jump exhausts a piece for the jumpExhaustion rule's turns.
        rallying    gets back the rallyAmount rule's HP at the end of each turn (hidden;
                    see Combat.js). Rallying gives a piece it for the rallyTurns rule's turns.
        rallied     can't rally (muted). Rallying gives a piece it for the rallyRefresh
                    rule's turns.
    
    A piece's effects are plain data, saved with it: piece.effects, [{id, countdown}].
    countdown is how many more turns it lasts: at the end of each turn (housekeeping, after
    action points come back) it goes down by 1, and the effect ends at 0. Getting an effect
    a piece already has adds to its countdown (so two jumps exhaust a piece for two turns).
    Other ways for an effect to end (a save, say) would be other properties beside id. */
(pkg => {
    'use strict';

    const {Subtypes} = pkg;
    
    pkg.EFFECT_EXHAUSTED = 'exhausted';
    pkg.EFFECT_RALLYING = 'rallying';
    pkg.EFFECT_RALLIED = 'rallied';
    pkg.effects = new Subtypes('effect', e => ({icon:typeof e.icon === 'string' ? e.icon : '', muted:e.muted === true, hidden:e.hidden === true}));
    
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
        }
    });
})(hc);
