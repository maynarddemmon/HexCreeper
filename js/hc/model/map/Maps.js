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
            if (!Base.has(config.type)) throw new Error(where + ' has an unknown type: ' + config.type);
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
        };
    
    let index = null; // init.json5, once loaded
    const loaded = new Map(); // map id -> map, once loaded
    
    /*  The maps. data/init.json5 lists every map with what a list of maps needs (its
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
        /*  Calls back with init.json5's contents, {defaultMap, maps:[...], materials,
            solids, holes, heals, harms, loots, enemies, enemyGroups}, or null if it couldn't
            be loaded. It's loaded once, and its materials and solid subtypes go to
            pkg.solids, its hole, heal, harm and loot subtypes to pkg.holes, pkg.heals,
            pkg.harms and pkg.loots, its characters to pkg.characters (see Combat.js), and its
            enemies and groups to pkg.enemies and pkg.enemyGroups (see Enemies.js). */
        loadIndex: callback => {
            if (index) {
                callback(index);
            } else {
                loadJSON5(DATA_BASE_DIR + 'init.json5', data => {
                    if (data && Array.isArray(data.maps)) {
                        index = data;
                        pkg.settings.setDefaultRules(data.rules);
                        pkg.solids.define(data.materials, data.solids);
                        pkg.holes.define(data.holes);
                        pkg.defineShadow(data.shadow);
                        pkg.heals.define(data.heals);
                        pkg.harms.define(data.harms);
                        pkg.loots.define(data.loots);
                        pkg.characters.define(data.characters);
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
