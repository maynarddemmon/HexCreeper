/*  A set of subtypes from data/init.json5: the kinds of a kind of tile (solid, hole,
    heal, harm and loot tiles), or the materials solids are made of. Every entry has a
    name and optionally a description; parse(entry, id) makes the rest of it usable, or
    gives null if it isn't, and the entry is left out with a console error ("Bad <kind>
    <id>"). Solids.js and EffectTiles.js make the sets. */
(pkg => {
    'use strict';
    
    const isText = v => v === undefined || typeof v === 'string';
    
    pkg.Subtypes = new JS.Class('Subtypes', {
        /*  kind: what the subtypes are of, for error messages. parse(entry, id): the
            subtype's own properties, {...}, or null. */
        initialize: function(kind, parse) {
            this.kind = kind;
            this.parse = parse;
            this.byId = new Map();
        },
        
        /*  Replaces the subtypes with those given, as init.json5 has them: {id:entry}.
            Each is {id, name, description, ...parse(entry, id)}. */
        define: function(data) {
            this.byId = new Map();
            for (const [id, entry] of Object.entries(data ?? {})) {
                const own = typeof entry?.name === 'string' && isText(entry.description) ? this.parse(entry, id) : null;
                if (own) {
                    this.byId.set(id, {id, name:entry.name, description:entry.description ?? '', ...own});
                } else {
                    console.error('Bad ' + this.kind, id);
                }
            }
        },
        
        /*  A subtype by id, or undefined. */
        get: function(id) {return this.byId.get(id);},
        
        /*  Every subtype, in the order init.json5 lists them. */
        list: function() {return [...this.byId.values()];}
    });
    
    /*  Helpers for parse functions: whether a value is a number that's not negative, a
        whole one, optional text, or an optional percentage (missing, or 0 to 100). */
    pkg.Subtypes.isNum = v => Number.isFinite(v) && v >= 0;
    pkg.Subtypes.isInt = v => Number.isInteger(v) && v >= 0;
    pkg.Subtypes.isText = isText;
    pkg.Subtypes.isPercent = v => v === undefined || (pkg.Subtypes.isNum(v) && v <= 100);
})(hc);
