/*  A set of subtypes from the game's data (data/environs.json5, entities.json5): the kinds of a kind of tile (solid, hole,
    heal, harm and loot tiles), or the materials solids are made of. Every entry has a
    name and optionally a description; parse(entry, id) makes the rest of it usable, or
    gives null if it isn't, and the entry is left out with a console error ("Bad <kind>
    <id>"). Solids.js and Fixtures.js make the sets (and Combat.js and Enemies.js, for
    characters, enemies and enemy groups).
    
    An entry may extend another of the same set: "extends":"<id>" makes it that entry,
    with its own properties over it. Objects (like a profile's stats) merge a property at
    a time, all the way down; anything else (text, numbers, arrays like damage) replaces
    the parent's. Parents can extend others in turn. It's all worked out once, as the set
    is defined, so lookups cost nothing more; an entry whose parent isn't there, or is
    bad, or that's in a loop (a extends b extends a), is left out with an error. Sets made
    with extendable false (enemy groups) don't do this. */
(pkg => {
    'use strict';
    
    const {isObj} = pkg,
        isText = v => v === undefined || typeof v === 'string',
        isNum = v => Number.isFinite(v) && v >= 0,
        
        // over on top of base: objects merged a property at a time, all the way down
        merge = (base, over) => {
            const out = {...base};
            for (const [k, v] of Object.entries(over)) {
                out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
            }
            return out;
        },
        
        /*  data ({id:entry}) with every "extends" worked out (see above): {entries:{id:entry},
            bad:{id:why}}. Entries keep the data's order. */
        resolveExtends = data => {
            const done = new Map(),  // id -> the entry worked out
                bad = new Map(),     // id -> why it can't be
                resolve = (id, chain) => {
                    if (done.has(id) || bad.has(id)) return;
                    const entry = data[id],
                        parent = isObj(entry) ? entry.extends : undefined;
                    let why = '';
                    if (parent === undefined) {
                        done.set(id, entry);
                        return;
                    }
                    if (typeof parent !== 'string' || !Object.hasOwn(data, parent)) {
                        why = 'it extends ' + JSON.stringify(parent) + ', which isn\'t there';
                    } else if (parent === id || chain.includes(parent)) {
                        // Everything in the loop is bad, for the same reason.
                        const loop = [...chain, id].slice([...chain, id].indexOf(parent));
                        for (const l of loop) {
                            bad.set(l, 'it extends in a loop: ' + [...loop, parent].join(' > '));
                        }
                        return;
                    } else {
                        resolve(parent, [...chain, id]);
                        if (bad.has(id)) return; // (in a loop)
                        if (bad.has(parent)) why = 'it extends ' + parent + ', which is bad';
                    }
                    if (why) {
                        bad.set(id, why);
                    } else {
                        const {extends:_parent, ...own} = entry;
                        done.set(id, merge(done.get(parent), own));
                    }
                };
            for (const id of Object.keys(data)) resolve(id, []);
            return {entries:Object.fromEntries(Object.keys(data).filter(id => done.has(id)).map(id => [id, done.get(id)])), bad};
        };
    
    pkg.Subtypes = new JS.Class('Subtypes', {
        // Class Methods and Attributes ////////////////////////////////////////
        extend: {
            /*  Helpers for parse functions: whether a value is a number that's not negative,
                optional text, or an optional percentage (missing, or 0 to 100). (For whole
                numbers, see pkg.isNatNum and the like.) */
            isText,
            isNum,
            isPercent: v => v === undefined || (isNum(v) && v <= 100)
        },
        
        /*  kind: what the subtypes are of, for error messages. parse(entry, id): the
            subtype's own properties, {...}, or null. extendable: whether entries may
            extend others (see above). */
        initialize: function(kind, parse, extendable=true) {
            this.kind = kind;
            this.parse = parse;
            this.extendable = extendable;
            this.byId = new Map();
        },
        
        /*  Replaces the subtypes with those given, as the data has them: {id:entry},
            with any "extends" worked out. Each is {id, name, description, ...parse(entry,
            id)}. */
        define: function(data) {
            this.byId = new Map();
            if (this.extendable && isObj(data)) {
                const {entries, bad} = resolveExtends(data);
                for (const [id, why] of bad) console.error('Bad ' + this.kind, id + ':', why);
                data = entries;
            }
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
        
        /*  Every subtype, in the order the data lists them. */
        list: function() {return [...this.byId.values()];}
    });
})(hc);
