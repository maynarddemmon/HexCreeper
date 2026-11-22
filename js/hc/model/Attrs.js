/*  Declaring and checking attrs: named values with a type, a default and a range or set of
    options. Preferences, map rules (Settings.js) and generators' attrs (Generators.js) are
    declared with these. */
(pkg => {
    'use strict';
    
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        /*  A value the attr can hold, or undefined: booleans must be booleans, choices one of
            the options (any text, before the options are known), and numbers are rounded
            and clamped. */
        normalize = (def, value) => {
            let retval;
            if (def.type === 'boolean') {
                if (typeof value === 'boolean') retval = value;
            } else if (def.type === 'choice') {
                const options = def.options();
                if (typeof value === 'string' && (!options.length || options.some(o => o.value === value))) retval = value;
            } else {
                const n = Math.round(Number(value));
                if (Number.isFinite(n)) retval = Math.min(def.max, Math.max(def.min, n));
            }
            return retval;
        };
    
    pkg.attrs = {
        /*  A whole number from min to max. */
        num: (id, defaultValue, min, max) => ({id, type:'number', defaultValue, min, max}),
        
        /*  True or false. */
        bool: (id, defaultValue) => ({id, type:'boolean', defaultValue}),
        
        /*  One of the values options() gives: [{value, label}]. */
        choice: (id, defaultValue, options) => ({id, type:'choice', defaultValue, options}),
        
        normalize,
        
        /*  The values given for the attrs defs declares, {id:value}, made usable: every one
            of defs, with its value given if that's usable, else its default. Unknown ids
            and values that can't be used are skipped with a warning saying where (e.g. "Map
            open_ground spawn generator"). With partial, only the attrs given are kept. */
        resolve: (defs, values, where, partial = false) => {
            const retval = {},
                byId = new Map(defs.map(def => [def.id, def]));
            if (values !== undefined && !isObj(values)) {
                console.warn(where, 'attrs must be an object, not', values);
            } else {
                for (const id in values ?? {}) {
                    const def = byId.get(id),
                        value = def ? normalize(def, values[id]) : undefined;
                    if (value === undefined) {
                        console.warn(where, 'attr', id, 'cannot be', values[id]);
                    } else {
                        retval[id] = value;
                    }
                }
            }
            if (!partial) {
                for (const def of defs) retval[def.id] ??= def.defaultValue;
            }
            return retval;
        }
    };
})(hc);
