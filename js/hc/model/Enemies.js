/*  Named enemies, from data/entities.json5 (see Maps.loadIndex):
    
    - enemies: {id:{name, description, ...}}, what a single enemy piece is, with its
      stats (see Combat.js, which makes the table, pkg.enemies).
    - enemyGroups: {id:{name, description, members}}, enemies as they come, linked into
      trees: members is a list of nodes, each the id of an enemy (one piece, on its own),
      or {id:[nodes]} for an enemy with those linked below it, or the id of a group,
      standing for all its trees (so a group can't have nodes below it). For example
      [{"goblin":["goblin", "goblin"]}] is a goblin with two more linked to it, and
      [{"goblin":["goblin_trio", "goblin_trio"]}] a goblin with two of those linked to it.
    
    An id names an enemy or a group, not both. A group that can't be used (a node of the
    wrong shape, an id that's neither, a group with nodes below it, or one that's in
    itself, at any depth) is left out with a console error. */
(pkg => {
    'use strict';
    
    const {Subtypes} = pkg,
        isNode = n => typeof n === 'string' ||
            (n && typeof n === 'object' && !Array.isArray(n) && Object.keys(n).length === 1 && isNodes(Object.values(n)[0])),
        isNodes = v => Array.isArray(v) && v.every(isNode);
    
    // (Groups are only their members, so there's nothing for one to extend: see Subtypes.js.)
    pkg.enemyGroups = new Subtypes('enemy group', entry => isNodes(entry.members) && entry.members.length ? {members:entry.members} : null, false);
    
    /*  Replaces the enemies and groups with those given, as the data has them. */
    pkg.defineEnemies = (enemies, groups) => {
        pkg.enemies.define(enemies);
        for (const e of pkg.enemies.list()) {
            for (const b of e.backgrounds) if (!pkg.backgrounds.get(b)) console.warn('Enemy', e.id, 'can have background', b, 'which there is none of');
        }
        pkg.enemyGroups.define(groups);
        for (const g of pkg.enemyGroups.list()) {
            const why = pkg.enemies.get(g.id) ? 'is an enemy too' : problem(g.id, []);
            if (why) {
                console.error('Bad enemy group', g.id + ':', why);
                pkg.enemyGroups.byId.delete(g.id);
            }
        }
    };
    
    // What's wrong with group id, or '' if nothing (within: the groups it's in).
    const problem = (id, within) => {
        if (within.includes(id)) return 'it is in itself';
        const check = node => {
            const [nid, below] = typeof node === 'string' ? [node, null] : Object.entries(node)[0];
            if (pkg.enemies.get(nid)) return below ? below.map(check).find(Boolean) ?? '' : '';
            if (!pkg.enemyGroups.get(nid)) return 'no enemy or group ' + nid;
            if (below) return 'group ' + nid + ' has nodes below it';
            return problem(nid, [...within, id]);
        };
        return pkg.enemyGroups.get(id).members.map(check).find(Boolean) ?? '';
    };
    
    /*  The trees of pieces enemy or group id comes as: [{enemyId, below:[...]}, ...], or
        null if there's no such enemy or group. */
    pkg.enemyTrees = id => {
        const expand = node => {
            const [nid, below] = typeof node === 'string' ? [node, null] : Object.entries(node)[0];
            return pkg.enemies.get(nid) ?
                [{enemyId:nid, below:(below ?? []).flatMap(expand)}] :
                pkg.enemyGroups.get(nid).members.flatMap(expand);
        };
        return pkg.enemies.get(id) || pkg.enemyGroups.get(id) ? expand(id) : null;
    };
})(hc);
