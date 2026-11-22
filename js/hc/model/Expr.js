(pkg => {
    'use strict';
    
    /*  A small expression language for map goals: a subset of JS expressions that can only
        reach the names it's given, so an expression from a file (or an imported save) can't
        run code.
        
        Numbers, true and false, names, calls of named functions, parentheses, and, from
        loosest to tightest: ? :, ||, &&, == != (=== !== mean the same), < <= > >=, + -,
        * / %, and the unary ! - +. && and || give true or false. */
    
    const BINARY = [
            ['||'],
            ['&&'],
            ['==', '!=', '===', '!=='],
            ['<', '<=', '>', '>='],
            ['+', '-'],
            ['*', '/', '%']
        ],
        OPS = {
            '||':(a, b) => !!(a() || b()),
            '&&':(a, b) => !!(a() && b()),
            '==':(a, b) => a() === b(),
            '!=':(a, b) => a() !== b(),
            '<':(a, b) => a() < b(),
            '<=':(a, b) => a() <= b(),
            '>':(a, b) => a() > b(),
            '>=':(a, b) => a() >= b(),
            '+':(a, b) => a() + b(),
            '-':(a, b) => a() - b(),
            '*':(a, b) => a() * b(),
            '/':(a, b) => a() / b(),
            '%':(a, b) => a() % b()
        },
        
        // Longest first, so <= is read before <.
        PUNCTUATION = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '!', '?', ':', '(', ')', ','],
        
        tokenize = src => {
            const tokens = [];
            let i = 0;
            while (i < src.length) {
                const rest = src.slice(i),
                    space = /^\s+/.exec(rest),
                    num = /^(\d+\.?\d*|\.\d+)/.exec(rest),
                    name = /^[A-Za-z_]\w*/.exec(rest);
                if (space) {
                    i += space[0].length;
                } else if (num) {
                    tokens.push({type:'num', value:Number(num[0]), at:i});
                    i += num[0].length;
                } else if (name) {
                    tokens.push({type:'name', value:name[0], at:i});
                    i += name[0].length;
                } else {
                    const p = PUNCTUATION.find(op => rest.startsWith(op));
                    if (!p) throw new Error(`Unexpected "${rest[0]}" at ${i}`);
                    tokens.push({type:'op', value:p === '===' ? '==' : p === '!==' ? '!=' : p, at:i});
                    i += p.length;
                }
            }
            tokens.push({type:'end', value:'', at:src.length});
            return tokens;
        };
    
    pkg.expr = {
        /*  Compiles src into a function of a scope, {value(name), call(name, args)}, that
            evaluates it. names and functions are the names it may use. Throws an Error that
            says what's wrong if src isn't an expression or uses another name. */
        compile: (src, names, functions) => {
            if (typeof src !== 'string') throw new Error('An expression must be a string');
            const tokens = tokenize(src);
            let pos = 0, scope;
            
            const peek = () => tokens[pos],
                isOp = v => peek().type === 'op' && peek().value === v,
                expect = v => {
                    if (!isOp(v)) fail(`Expected "${v}"`);
                    pos++;
                },
                fail = msg => {
                    const t = peek();
                    throw new Error(`${msg} at ${t.at}${t.type === 'end' ? ' (the end)' : ` ("${t.value}")`}`);
                },
                
                ternary = () => {
                    const test = binary(0);
                    if (!isOp('?')) return test;
                    pos++;
                    const yes = ternary();
                    expect(':');
                    const no = ternary();
                    return () => test() ? yes() : no();
                },
                binary = level => {
                    if (level === BINARY.length) return unary();
                    let left = binary(level + 1);
                    while (peek().type === 'op' && BINARY[level].includes(peek().value)) {
                        const op = OPS[tokens[pos++].value],
                            a = left, b = binary(level + 1);
                        left = () => op(a, b);
                    }
                    return left;
                },
                unary = () => {
                    if (isOp('!') || isOp('-') || isOp('+')) {
                        const op = tokens[pos++].value, a = unary();
                        return op === '!' ? () => !a() : op === '-' ? () => -a() : () => +a();
                    }
                    return primary();
                },
                primary = () => {
                    const t = peek();
                    if (t.type === 'num') {
                        pos++;
                        return () => t.value;
                    }
                    if (t.type === 'name') {
                        pos++;
                        if (t.value === 'true') return () => true;
                        if (t.value === 'false') return () => false;
                        if (isOp('(')) {
                            if (!functions.includes(t.value)) throw new Error(`Unknown function "${t.value}" at ${t.at}`);
                            pos++;
                            const args = [];
                            if (!isOp(')')) {
                                do args.push(ternary()); while (isOp(',') && ++pos);
                            }
                            expect(')');
                            return () => scope.call(t.value, args.map(a => a()));
                        }
                        if (!names.includes(t.value)) throw new Error(`Unknown name "${t.value}" at ${t.at}`);
                        return () => scope.value(t.value);
                    }
                    if (isOp('(')) {
                        pos++;
                        const inner = ternary();
                        expect(')');
                        return inner;
                    }
                    fail('Unexpected');
                };
            
            const root = ternary();
            if (peek().type !== 'end') fail('Unexpected');
            return s => {
                scope = s;
                try {
                    return root();
                } finally {
                    scope = null;
                }
            };
        }
    };
})(hc);
