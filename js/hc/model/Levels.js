(pkg => {
    'use strict';
    
    const {cfg:{DATA_BASE_DIR}} = pkg,
        
        LEVELS_DIR = DATA_BASE_DIR + 'levels/',
        
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
    const loaded = new Map(); // level id -> level, once loaded
    
    /*  The levels. data/init.json5 lists every level with what a list of levels needs (its
        id, name, number and description), and names the level played when there's no saved
        game. Each level's own file, data/levels/<id>.json5, holds what's needed to play it,
        and is loaded only when it's played.
        
        A level, once loaded, is its entry in init.json5 merged with its file:
            {id, name, number, description, attrs:{<setting id>:value, ...}, objectives:[...]}
        where objectives are its goals and penalties (see goals.fromLevel). */
    pkg.levels = {
        /*  Calls back with init.json5's contents, {defaultLevel, levels:[...], materials,
            solids}, or null if it couldn't be loaded. It's loaded once, and its materials
            and solid subtypes go to pkg.solids. */
        loadIndex: callback => {
            if (index) {
                callback(index);
            } else {
                loadJSON5(DATA_BASE_DIR + 'init.json5', data => {
                    if (data && Array.isArray(data.levels)) {
                        index = data;
                        pkg.solids.define(data.materials, data.solids);
                    }
                    callback(index);
                });
            }
        },
        
        /*  Calls back with the level, or null if it isn't in init.json5 or its file couldn't
            be loaded. Each level is loaded once. */
        loadLevel: (id, callback) => {
            if (loaded.has(id)) {
                callback(loaded.get(id));
                return;
            }
            pkg.levels.loadIndex(idx => {
                const entry = idx?.levels.find(level => level.id === id);
                if (!entry) {
                    console.error('Unknown level', id);
                    callback(null);
                    return;
                }
                loadJSON5(LEVELS_DIR + id + '.json5', data => {
                    if (!data) {
                        callback(null);
                        return;
                    }
                    let objectives;
                    try {
                        objectives = pkg.goals.fromLevel(data);
                    } catch (err) {
                        console.error('Bad goals in level', id, err.message);
                        callback(null);
                        return;
                    }
                    const level = {...entry, ...data, id, attrs:data.attrs ?? {}, objectives};
                    loaded.set(id, level);
                    callback(level);
                });
            });
        }
    };
})(hc);
