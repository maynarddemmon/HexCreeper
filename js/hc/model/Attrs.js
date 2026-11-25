/*  Declaring and checking attrs: named values with a type, a default and a range or set of
    options. Preferences, map rules (Settings.js) and map components' attrs
    (MapComponent.js) are declared with these. */
(pkg => {
    'use strict';
    
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v),
        
        // The functions an expr attr's formula can call: JavaScript's Math functions (max,
        // floor, pow, sign, hypot...), all but random, since a formula gives the same for
        // the same values.
        FUNCTIONS = Object.fromEntries(Object.getOwnPropertyNames(Math)
            .filter(name => typeof Math[name] === 'function' && name !== 'random').map(name => [name, Math[name]])),
        
        /*  An expr attr's formula, text, made into a function of its variables, f({name:n}),
            or an Error saying what's wrong with it. names: the variables it may use (a
            true or false one counts as 1 or 0). Numbers, + - * / % and ^ (power), with the
            usual precedence, unary minus, parentheses and FUNCTIONS, by name, with "Math."
            in front or not (max(a, b) or Math.max(a, b)); and, looser than those,
            comparisons (< <= > >=, then == !=), && and ||, each 1 for true or 0 for false,
            and c ? a : b (a if c isn't 0, else b), loosest of all. ! (not: 1 for 0, else 0)
            is as tight as unary minus. Made once for each text (formulas). */
        formulas = new Map(),
        compile = (text, names) => {
            const key = names.join() + '|' + text;
            let retval = formulas.get(key);
            if (!retval) {
                const tokens = text.match(/\d+(\.\d+)?|[A-Za-z_]\w*|<=|>=|==|!=|&&|\|\||\S/g) ?? [];
                let i = 0;
                const peek = () => tokens[i],
                    take = t => {
                        if (tokens[i] !== t) throw new Error('expected ' + t + (tokens[i] ? ' at ' + tokens[i] : ' at the end'));
                        i++;
                    },
                    binary = (next, ops) => () => {
                        let f = next();
                        while (ops[peek()]) {
                            const op = ops[tokens[i++]], a = f, b = next();
                            f = v => op(a(v), b(v));
                        }
                        return f;
                    },
                    primary = () => {
                        const t = tokens[i++];
                        if (t === undefined) throw new Error('it ends too soon');
                        if (/^\d/.test(t)) {
                            const n = Number(t);
                            return () => n;
                        }
                        if (t === '(') {
                            const f = ternary();
                            take(')');
                            return f;
                        }
                        if (t === '-') {
                            const f = power();
                            return v => -f(v);
                        }
                        if (t === '!') {
                            const f = power();
                            return v => f(v) ? 0 : 1;
                        }
                        // A name: a variable or a function (after "Math.", a function).
                        let name = /^[A-Za-z_]/.test(t) ? t : null;
                        if (t === 'Math' && peek() === '.') {
                            i++;
                            name = tokens[i++];
                            if (!Object.hasOwn(FUNCTIONS, name ?? '') || peek() !== '(') throw new Error('no function Math.' + (name ?? ''));
                        }
                        if (name) {
                            if (peek() === '(') {
                                const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : null;
                                if (!fn) throw new Error('no function ' + name);
                                i++;
                                const args = [ternary()];
                                while (peek() === ',') {
                                    i++;
                                    args.push(ternary());
                                }
                                take(')');
                                return v => fn(...args.map(a => a(v)));
                            }
                            if (!names.includes(name)) throw new Error('no variable ' + name);
                            return v => Number(v[name]);
                        }
                        throw new Error('unexpected ' + t);
                    },
                    power = () => {
                        const a = primary();
                        if (peek() !== '^') return a;
                        i++;
                        const b = power();
                        return v => a(v) ** b(v);
                    },
                    product = binary(power, {'*':(a, b) => a * b, '/':(a, b) => a / b, '%':(a, b) => a % b}),
                    sum = binary(product, {'+':(a, b) => a + b, '-':(a, b) => a - b}),
                    truth = b => b ? 1 : 0,
                    comparison = binary(sum, {'<':(a, b) => truth(a < b), '<=':(a, b) => truth(a <= b), '>':(a, b) => truth(a > b), '>=':(a, b) => truth(a >= b)}),
                    equality = binary(comparison, {'==':(a, b) => truth(a === b), '!=':(a, b) => truth(a !== b)}),
                    and = binary(equality, {'&&':(a, b) => truth(a && b)}),
                    or = binary(and, {'||':(a, b) => truth(a || b)}),
                    ternary = () => {
                        const c = or();
                        let f = c;
                        if (peek() === '?') {
                            i++;
                            const a = ternary();
                            take(':');
                            const b = ternary();
                            f = v => c(v) ? a(v) : b(v);
                        }
                        return f;
                    };
                try {
                    const f = ternary();
                    if (i < tokens.length) throw new Error('unexpected ' + tokens[i]);
                    retval = f;
                } catch (err) {
                    retval = err;
                }
                formulas.set(key, retval);
            }
            return retval;
        },
        
        // Whether value is a tiers attr's list of tiers: [{min, max?, table}], min and max
        // whole numbers (max no less than min), and table as a table attr's value.
        isTiers = (def, value) => Array.isArray(value) && value.length > 0 && value.every(t => isObj(t) &&
            Number.isInteger(t.min) && (t.max === undefined || (Number.isInteger(t.max) && t.max >= t.min)) &&
            isObj(t.table) && Object.entries(t.table).every(([k, w]) => isOption(def, k) && Number.isInteger(w) && w >= 0 && w <= 1000)),
        
        // Whether value is one of a choice or table attr's options (anything, before the
        // options are known).
        isOption = (def, value) => {
            const options = def.options();
            return !options.length || options.some(o => o.value === value);
        },
        
        /*  A value the attr can hold, or undefined: booleans must be booleans, choices one of
            the options, tables {option:weight} with whole-number weights from 0 to 1000,
            exprs formulas that make sense (see compile), tiers lists of tiers (see
            isTiers), and numbers are rounded (to a whole number of steps) and clamped. */
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
            } else if (def.type === 'expr') {
                if (typeof value === 'string' && !(compile(value, def.names) instanceof Error)) retval = value;
            } else if (def.type === 'tiers') {
                if (isTiers(def, value)) retval = value.map(t => ({...t, table:{...t.table}}));
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
        
        /*  A formula (text) of the variables names (['rank', ...]) to work out with values
            given for them (see evaluate). */
        expr: (id, defaultValue, names) => ({id, type:'expr', defaultValue, names}),
        
        /*  Tables (as for table) for ranges of a number, [{min, max, table}, ...] (no max:
            min and up), to pick one of the values options() gives from by the number (see
            pickTier). */
        tiers: (id, defaultValue, options) => ({id, type:'tiers', defaultValue, options}),
        
        /*  What an expr attr's formula (text) comes to, with values for its variables
            ({name:n}; names, the variables it may use): a number, or NaN if the formula
            doesn't make sense. */
        evaluate: (text, names, values) => {
            const f = compile(text, names);
            return f instanceof Error ? NaN : f(values);
        },
        
        /*  What's wrong with formula text for the variables names, or '' if nothing. */
        formulaProblem: (text, names) => {
            const f = compile(text, names);
            return f instanceof Error ? f.message : '';
        },
        
        /*  A value from a tiers attr's value for the number n: picked (see pick) from the
            first tier n is in, or the highest if n is above them all; undefined if n is
            below them all (or the tier's weights are all 0). */
        pickTier: (tiers, n, rng) => {
            const tier = tiers.find(t => n >= t.min && (t.max === undefined || n <= t.max)) ??
                (n > Math.max(...tiers.map(t => t.max ?? Infinity)) ? tiers.reduce((a, b) => b.min > a.min ? b : a) : null);
            return tier ? pkg.attrs.pick(tier.table, rng) : undefined;
        },
        
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
