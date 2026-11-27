/*  Map goals and penalties. A goal is something to achieve and a penalty something to
    avoid; each has an expression (see Expr.js) over the values below. pkg.Goals, the
    module included in Game, evaluates them: evaluateObjectives. */
(pkg => {
    'use strict';
    
    const {hexDist} = pkg,
        
        // The values an expression can use, from the game.
        VALUES = {
            turn:g => g.turn,
            gold:g => g.gold,
            coreHp:g => Math.max(0, g.getPlayerCore()?.hp ?? 0),
            coreMaxHp:g => g.getPlayerCore()?.maxHp ?? 0,
            coreLevel:g => g.getPlayerCore()?.level ?? 0,
            coreX:g => corePos(g).x,
            coreY:g => corePos(g).y,
            coreDist:g => hexDist(corePos(g), {x:0, y:0}),
            pieces:g => g.piecesOf('player').length,
            maxLevel:g => g.maxLevel(),
            totalLevels:g => g.totalLevels(),
            piecesLost:g => g.piecesLost,
            piecesPlaced:g => g.piecesPlaced,
            lootOpened:g => g.lootOpened,
            lootTaken:g => g.lootTaken,
            enemies:g => g.piecesOf('enemy').length,
            kills:g => g.kills,
            quadsVisited:g => g.tileGenerator.visitedQuads?.size ?? 0 // with a generator that has quadrants
        },
        FUNCTIONS = {
            dist:(g, x, y) => hexDist(corePos(g), {x, y}),
            min:(g, ...a) => Math.min(...a),
            max:(g, ...a) => Math.max(...a),
            abs:(g, a) => Math.abs(a)
        },
        NAMES = Object.keys(VALUES),
        FUNCTION_NAMES = Object.keys(FUNCTIONS),
        
        // Where the core is, or was last.
        corePos = g => {
            const core = g.getPlayerCore();
            if (core) return core;
            const [x, y] = g.corePath.at(-1) ?? [0, 0];
            return {x, y};
        },
        
        // An expression, compiled once (see Expr.js). Throws if it isn't one.
        compiled = new Map(),
        compile = src => {
            if (!compiled.has(src)) compiled.set(src, pkg.expr.compile(src, NAMES, FUNCTION_NAMES));
            return compiled.get(src);
        },
        
        /*  A progress template, compiled once: its text, split into strings and the
            compiled expressions between { and }. Throws if a brace isn't matched or an
            expression isn't one. */
        templates = new Map(),
        compileTemplate = src => {
            if (!templates.has(src)) {
                const parts = [];
                let i = 0;
                while (i < src.length) {
                    const open = src.indexOf('{', i), close = src.indexOf('}', i);
                    if (close >= 0 && (open < 0 || close < open)) {
                        throw new Error(`Unmatched "}" at ${close}`);
                    }
                    if (open < 0) {
                        parts.push(src.slice(i));
                        break;
                    }
                    if (close < 0) throw new Error(`Unmatched "{" at ${open}`);
                    parts.push(src.slice(i, open));
                    try {
                        parts.push(compile(src.slice(open + 1, close)));
                    } catch (err) {
                        throw new Error(`In "{${src.slice(open + 1, close)}}": ${err.message}`, {cause:err});
                    }
                    i = close + 1;
                }
                templates.set(src, parts);
            }
            return templates.get(src);
        },
        
        // A value as progress text: whole numbers as they are, others to one decimal place.
        formatValue = v => typeof v === 'number' && !Number.isInteger(v) && Number.isFinite(v) ? String(Math.round(v * 10) / 10) : String(v),
        
        isBool = v => v === undefined || typeof v === 'boolean';
    
    pkg.goals = {
        NAMES,
        FUNCTION_NAMES,
        compile,
        compileTemplate,
        
        /*  A map's goals and penalties, from its file's "goals" and "penalties", as one
            list of objectives: {kind:'goal' | 'penalty', name, description, expression,
            progress, lockOnSuccess, lockOnFailure, required}, with the defaults filled in.
            progress is text with expressions in braces, e.g. "{kills}/40 destroyed"; it's
            shown as play goes on (see evaluateObjectives). Throws an Error saying what's
            wrong with the first bad one. */
        fromMap: data => {
            const objectives = [];
            for (const kind of ['goal', 'penalty']) {
                const list = data?.[kind === 'goal' ? 'goals' : 'penalties'] ?? [];
                if (!Array.isArray(list)) {
                    throw new Error(`"${kind === 'goal' ? 'goals' : 'penalties'}" must be a list`);
                }
                list.forEach((o, i) => {
                    const where = `${kind} ${i + 1}`;
                    if (typeof o?.name !== 'string' || !o.name) {
                        throw new Error(`The ${where} needs a name`);
                    }
                    if (o.description !== undefined && typeof o.description !== 'string') {
                        throw new Error(`The ${where}'s description must be text`);
                    }
                    if (!isBool(o.lockOnSuccess) || !isBool(o.lockOnFailure) || !isBool(o.required)) {
                        throw new Error(`The ${where}'s lockOnSuccess, lockOnFailure and required must be true or false`);
                    }
                    try {
                        compile(o.expression);
                    } catch (err) {
                        throw new Error(`The ${where}'s expression: ${err.message}`, {cause:err});
                    }
                    if (o.progress !== undefined && typeof o.progress !== 'string') {
                        throw new Error(`The ${where}'s progress must be text`);
                    }
                    try {
                        compileTemplate(o.progress ?? '');
                    } catch (err) {
                        throw new Error(`The ${where}'s progress: ${err.message}`, {cause:err});
                    }
                    objectives.push({
                        kind,
                        name:o.name,
                        description:o.description ?? '',
                        expression:o.expression,
                        progress:o.progress ?? '',
                        lockOnSuccess:o.lockOnSuccess ?? false,
                        lockOnFailure:o.lockOnFailure ?? false,
                        required:o.required ?? true
                    });
                });
            }
            return objectives;
        },
        
        /*  Whether an objective in that state is where the player wants it: a goal true or
            a penalty false. */
        isGood: (objective, state) => state.value === (objective.kind === 'goal')
    };
    
    pkg.Goals = new JS.Module('Goals', {
        // The map's objectives (see goals.fromMap).
        getMapObjectives: function() { return this.gameMap?.objectives ?? []; },
        
        /*  Evaluates the objectives that aren't locked, and their progress text (so a locked
            one's stays as it was when it locked), locking any that lock, then ends the
            game if the map is won (every required goal true and penalty false) or can't
            be won any more (a required one locked the wrong way). A map with nothing
            required can't be won. */
        evaluateObjectives: function() {
            if (this.over) return;
            const list = this.getMapObjectives(),
                scope = {
                    value:name => VALUES[name](this),
                    call:(name, args) => FUNCTIONS[name](this, ...args)
                };
            list.forEach((o, i) => {
                const state = this.objectives[i];
                if (state.locked) return;
                state.value = !!compile(o.expression)(scope);
                state.progress = compileTemplate(o.progress ?? '').map(part => typeof part === 'string' ? part : formatValue(part(scope))).join('');
                if (state.value ? o.lockOnSuccess : o.lockOnFailure) state.locked = true;
            });
            
            const required = list.map((o, i) => [o, this.objectives[i]]).filter(([o]) => o.required),
                lostBy = required.findIndex(([o, s]) => s.locked && !pkg.goals.isGood(o, s));
            if (lostBy >= 0) {
                this.endGame('lost', list.indexOf(required[lostBy][0]));
            } else if (required.length && required.every(([o, s]) => pkg.goals.isGood(o, s))) {
                this.endGame('won');
            }
        },
        
        /*  Ends the game: outcome 'won' or 'lost'. lostBy is the index of the objective that
            lost it, or null when the core was destroyed. */
        endGame: function(outcome, lostBy = null) {
            this.over = true;
            this.outcome = outcome;
            this.lostBy = lostBy;
        }
    });
})(hc);
