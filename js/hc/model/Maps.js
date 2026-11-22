(pkg => {
    'use strict';
    
    const {cfg:{DATA_BASE_DIR}} = pkg,
        
        MAPS_DIR = DATA_BASE_DIR + 'gamemap/',
        
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
        
        A map, once loaded, is its entry in init.json5 merged with its file:
            {id, name, number, description, attrs:{<setting id>:value, ...}, objectives:[...]}
        where objectives are its goals and penalties (see goals.fromMap). */
    pkg.maps = {
        /*  Calls back with init.json5's contents, {defaultMap, maps:[...], materials,
            solids, holes, heals, harms, loots}, or null if it couldn't be loaded. It's loaded
            once, and its materials and solid subtypes go to pkg.solids, and its hole, heal,
            harm and loot subtypes to pkg.holes, pkg.heals, pkg.harms and pkg.loots. */
        loadIndex: callback => {
            if (index) {
                callback(index);
            } else {
                loadJSON5(DATA_BASE_DIR + 'init.json5', data => {
                    if (data && Array.isArray(data.maps)) {
                        index = data;
                        pkg.solids.define(data.materials, data.solids);
                        pkg.holes.define(data.holes);
                        pkg.heals.define(data.heals);
                        pkg.harms.define(data.harms);
                        pkg.loots.define(data.loots);
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
                    let objectives;
                    try {
                        objectives = pkg.goals.fromMap(data);
                    } catch (err) {
                        console.error('Bad goals in map', id, err.message);
                        callback(null);
                        return;
                    }
                    const gameMap = {...entry, ...data, id, attrs:data.attrs ?? {}, objectives};
                    loaded.set(id, gameMap);
                    callback(gameMap);
                });
            });
        }
    };
})(hc);
