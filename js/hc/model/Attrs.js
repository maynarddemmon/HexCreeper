/*  Declaring and checking attrs: named values with a type, a default and a range or set of
    options. Preferences, map rules (Settings.js) and map components' attrs
    (MapComponent.js) are declared with these. */
(pkg => {
    'use strict';
    
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        // Whether value is one of a choice or table attr's options (anything, before the
        // options are known).
        isOption = (def, value) => {
            const options = def.options();
            return !options.length || options.some(o => o.value === value);
        },
        
        /*  A value the attr can hold, or undefined: booleans must be booleans, choices one of
            the options, tables {option:weight} with whole-number weights from 0 to 1000,
            and numbers are rounded (to a whole number of steps) and clamped. */
        normalize = (def, value) => {
            let retval;
            if (def.type === 'boolean') {
                if (typeof value === 'boolean') retval = value;
            } else if (def.type === 'choice') {
                if (typeof value === 'string' && isOption(def, value)) retval = value;
            } else if (def.type === 'table') {
                if (isObj(value) && Object.entries(value).every(([k, w]) => isOption(def, k) && Number.isInteger(w) && w >= 0 && w <= 1000)) {
                    retval = {...value};
                }
            } else {
                const n = Math.round(Number(value) / def.step) / (1 / def.step);
                if (Number.isFinite(n)) retval = Math.min(def.max, Math.max(def.min, n));
            }
            return retval;
        };
    
    pkg.attrs = {
        /*  A number from min to max, in steps of step (whole numbers by default; a step
            below 1 should be 1/n, e.g. 0.1). */
        num: (id, defaultValue, min, max, step=1) => ({id, type:'number', defaultValue, min, max, step}),
        
        /*  True or false. */
        bool: (id, defaultValue) => ({id, type:'boolean', defaultValue}),
        
        /*  One of the values options() gives: [{value, label}]. */
        choice: (id, defaultValue, options) => ({id, type:'choice', defaultValue, options}),
        
        /*  Weights for some of the values options() gives, {value:weight}, to pick one of
            them at random (see pick). */
        table: (id, defaultValue, options) => ({id, type:'table', defaultValue, options}),
        
        /*  A value from a table attr's value ({value:weight}), picked at random by rng in
            proportion to the weights, or undefined if they're all 0 (or there are none). */
        pick: (table, rng) => {
            const entries = Object.entries(table).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
                total = entries.reduce((sum, [, w]) => sum + w, 0);
            let retval,
                n = rng() * total;
            for (const [value, w] of entries) {
                if (retval === undefined && w > 0) {
                    if (n < w) {
                        retval = value;
                    } else {
                        n -= w;
                    }
                }
            }
            return retval;
        },
        
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
