(pkg => {
    'use strict';
    
    const {cfg:{DATA_BASE_DIR}, isObj} = pkg,
        
        MAPS_DIR = DATA_BASE_DIR + 'gamemap/',
        
        /*  A map file's "tileGenerator", "spawnGenerator" or "enemyAI", {type, ...attrs},
            made usable: {type, attrs}, its attrs cleaned (see MapComponent.cleanAttrs).
            Base is TileGenerator, SpawnGenerator or EnemyAI. Throws if it isn't an object
            whose type is registered with Base. */
        componentOf = (Base, config, where) => {
            if (!isObj(config)) throw new Error(where + ' is missing');
            if (!Base.has(config.type)) {
                throw new Error(where + ' has an unknown type: ' + config.type);
            }
            const {type, ...attrs} = config;
            return {type, attrs:Base.cleanAttrs(type, attrs, where)};
        },
        
        // Loads a JSON5 file. Calls back with the parsed data, or null if it couldn't be
        // loaded or parsed.
        loadJSON5 = (url, callback) => {
            pkg.loadTxt(url, (success, txt) => {
                let data = null;
                if (success) {
                    try {
                        data = JSON5.parse(txt);
                    } catch (err) {
                        console.error('Unable to parse', url, err);
                    }
                }
                callback(data);
            });
        },
        
        /*  Loads the data file at path (from the data directory) and those it includes, in
            turn: its "include", a list of paths. Calls back with all their tables (their
            top-level properties, but "include") in one object, or null if any file couldn't
            be loaded, isn't an object, or has a bad include. A table in more than one file
            is an error: the first is kept (this file's, then its includes' in order). A file
            included twice (a loop, say) is an error too. seen is the paths loaded so far. */
        loadData = (path, callback, seen=new Set()) => {
            seen.add(path);
            loadJSON5(DATA_BASE_DIR + path, data => {
                const {include = [], ...tables} = isObj(data) ? data : {},
                    includes = Array.isArray(include) && include.every(p => typeof p === 'string') ? include : null,
                    found = new Array(includes?.length ?? 0);
                let left = found.length,
                    ok = isObj(data) && !!includes;
                if (data && !ok) {
                    console.error('Data file', path, 'is not an object, or has an include that isn\'t a list of paths');
                }
                const done = () => {
                    let merged = null;
                    if (ok) {
                        merged = tables;
                        for (const more of found) {
                            for (const [table, value] of Object.entries(more)) {
                                if (table in merged) {
                                    console.error('Table', table, 'is in more than one data file (see', path + '): the first is kept');
                                } else {
                                    merged[table] = value;
                                }
                            }
                        }
                    }
                    callback(merged);
                };
                if (!ok || left === 0) {
                    done();
                } else {
                    includes.forEach((p, i) => {
                        const got = more => {
                            found[i] = more ?? {};
                            if (!more) ok = false;
                            if (--left === 0) done();
                        };
                        if (seen.has(p)) {
                            console.error('Data file', p, 'is included more than once (by', path + ')');
                            got(null);
                        } else {
                            loadData(p, got, seen);
                        }
                    });
                }
            });
        };
    
    let index = null; // init.json5 and what it includes, once loaded
    const loaded = new Map(); // map id -> map, once loaded
    
    /*  The game's data is data/init.json5 and the files it includes (rules.json5,
        environs.json5 and entities.json5, which could include more in turn: see loadData),
        their tables merged into one.
        
        The maps. data/init.json5 lists every map with what a list of maps needs (its
        id, name, number and description), and names the map played when there's no saved
        game. Each map's own file, data/gamemap/<id>.json5, holds what's needed to play it,
        and is loaded only when it's played.
        
        A map's file has (see docs/DESIGN.md, Maps):
            rules: gameplay values in place of their defaults, {id:value} (see Settings.js);
            tileGenerator: {type, ...attrs}: what makes its tiles: a type registered with
                TileGenerator, and values for that type's attrs (see Generators.js);
            spawnGenerator: {type, ...attrs}: what makes its enemies, likewise;
            enemyAI: {type, ...attrs}: what plays the enemies' turn, likewise (see
                EnemyAI.js);
            goals and penalties, and optionally a seed.
        
        A map, once loaded, is its entry in init.json5 merged with its file:
            {id, name, number, description, seed, rules:{id:value}, tileGenerator:{type,
            attrs}, spawnGenerator:{type, attrs}, enemyAI:{type, attrs}, objectives:[...]}
        where objectives are its goals and penalties (see goals.fromMap). Rules and attrs
        are only those the file gives, made usable (any that can't be are skipped with a
        warning). A map whose goals or components can't be used isn't loaded. */
    pkg.maps = {
        /*  Calls back with the game's data (init.json5 and what it includes),
            {defaultMap, maps:[...], rules, materials, solids, holes, fixtures, species,
            enemies, enemyGroups, ...}, or null if it couldn't be loaded. It's loaded once,
            and its rules become the defaults; its materials and solid subtypes go to
            pkg.solids, its hole and floor subtypes to pkg.holes and pkg.floors, its
            fixtures to pkg.fixtures (see Fixtures.js), its species and backgrounds to
            pkg.species and pkg.backgrounds (see Combat.js), and its enemies and groups to
            pkg.enemies and pkg.enemyGroups (see Enemies.js). */
        loadIndex: callback => {
            if (index) {
                callback(index);
            } else {
                loadData('init.json5', data => {
                    if (data && Array.isArray(data.maps)) {
                        index = data;
                        
                        // Rules
                        pkg.settings.setDefaultRules(data.rules);
                        
                        // Environs
                        pkg.solids.define(data.materials, data.solids);
                        pkg.holes.define(data.holes);
                        pkg.floors.define(data.floors);
                        for (const s of pkg.solids.list()) {
                            if (s.floor && !pkg.floors.get(s.floor)) {
                                console.warn('Solid', s.id, 'leaves floor', s.floor, 'which there is none of');
                            }
                        }
                        pkg.defineShadow(data.shadow);
                        pkg.fixtures.define(data.fixtures);
                        for (const f of pkg.fixtures.list()) {
                            if (f.floor && !pkg.floors.get(f.floor)) {
                                console.warn('Fixture', f.id, 'leaves floor', f.floor, 'which there is none of');
                            }
                            if (f.destroyInto && !pkg.fixtures.get(f.destroyInto)) {
                                console.warn('Fixture', f.id, 'leaves fixture', f.destroyInto, 'which there is none of');
                            }
                        }
                        pkg.effects.define(data.effects);
                        
                        // Entities
                        pkg.species.define(data.species);
                        pkg.backgrounds.define(data.backgrounds);
                        for (const s of pkg.species.list()) {
                            for (const b of s.backgrounds ?? []) {
                                if (!pkg.backgrounds.get(b)) console.warn('Species', s.id, 'allows background', b, 'which there is none of');
                            }
                        }
                        for (const b of pkg.backgrounds.list()) {
                            for (const s of b.species ?? []) {
                                if (!pkg.species.get(s)) console.warn('Background', b.id, 'allows species', s, 'which there is none of');
                            }
                        }
                        pkg.defineEnemies(data.enemies, data.enemyGroups);
                    }
                    callback(index);
                });
            }
        },
        
        /*  Calls back with the map, or null if it isn't in init.json5 or its file couldn't
            be loaded. Each map is loaded once. */
        loadMap: (id, callback) => {
            if (loaded.has(id)) {
                callback(loaded.get(id));
                return;
            }
            pkg.maps.loadIndex(idx => {
                const entry = idx?.maps.find(m => m.id === id);
                if (!entry) {
                    console.error('Unknown map', id);
                    callback(null);
                    return;
                }
                loadJSON5(MAPS_DIR + id + '.json5', data => {
                    if (!data) {
                        callback(null);
                        return;
                    }
                    const where = 'Map ' + id;
                    let gameMap = null;
                    try {
                        gameMap = {
                            ...entry, ...data, id,
                            rules:pkg.settings.cleanRules(data.rules, where),
                            tileGenerator:componentOf(pkg.TileGenerator, data.tileGenerator, where + ' tile generator'),
                            spawnGenerator:componentOf(pkg.SpawnGenerator, data.spawnGenerator, where + ' spawn generator'),
                            enemyAI:componentOf(pkg.EnemyAI, data.enemyAI, where + ' enemy AI'),
                            objectives:pkg.goals.fromMap(data)
                        };
                        loaded.set(id, gameMap);
                    } catch (err) {
                        console.error('Bad map', id, err.message);
                    }
                    callback(gameMap);
                });
            });
        }
    };
})(hc);
