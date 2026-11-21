/*  Materials and solid subtypes, from data/init.json5. A material has a hardness, which
    is the damage reduction (dr) of anything made of it, and a density (not used yet). A
    solid subtype is a kind of solid tile: its name, its composition (a material) and its
    hit points, since how much a solid can take depends on how much material is in it, and
    optionally the colours it's drawn in, fillColor and borderColor (any CSS colour, or a
    --variable from index.html), in place of the usual solid colours. */
(pkg => {
    'use strict';
    
    const isNum = v => Number.isFinite(v) && v >= 0,
        isText = v => v === undefined || typeof v === 'string';
    
    let materials = new Map(), // id -> {id, name, hardness, density, description}
        subtypes = new Map();  // id -> {id, name, composition, hp, description, fillColor, borderColor, material, dr}
    
    pkg.solids = {
        /*  Replaces the materials and subtypes with those given, as init.json5 has them:
            {id:{name, hardness, density, description}} and
            {id:{name, composition, hp, description, fillColor, borderColor}}. An entry that isn't usable is left
            out, with a console error saying why. */
        define: (materialData, subtypeData) => {
            materials = new Map();
            subtypes = new Map();
            for (const [id, m] of Object.entries(materialData ?? {})) {
                if (typeof m?.name !== 'string' || !isNum(m.hardness) || !(m.density === undefined || isNum(m.density)) || !isText(m.description)) {
                    console.error('Bad material', id);
                } else {
                    materials.set(id, {id, name:m.name, hardness:m.hardness, density:m.density ?? 0, description:m.description ?? ''});
                }
            }
            for (const [id, s] of Object.entries(subtypeData ?? {})) {
                const material = materials.get(s?.composition);
                if (typeof s?.name !== 'string' || !material || !Number.isInteger(s.hp) || s.hp < 1 || !isText(s.description) || !isText(s.fillColor) || !isText(s.borderColor)) {
                    console.error('Bad solid', id);
                } else {
                    subtypes.set(id, {
                        id, name:s.name, composition:s.composition, hp:s.hp, description:s.description ?? '',
                        fillColor:s.fillColor || null, borderColor:s.borderColor || null,
                        material, dr:material.hardness
                    });
                }
            }
        },
        
        /*  A solid subtype by id, or undefined. */
        get: id => subtypes.get(id),
        
        /*  Every solid subtype, in the order init.json5 lists them. */
        list: () => [...subtypes.values()],
        
        /*  A material by id, or undefined. */
        getMaterial: id => materials.get(id)
    };
})(hc);
