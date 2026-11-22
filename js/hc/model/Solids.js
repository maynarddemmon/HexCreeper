/*  Materials and solid subtypes, from data/init.json5. A material has a hardness, which
    is the damage reduction (dr) of anything made of it, a density (not used yet) and an
    opacity (0-100, default 100: how much it blocks sight). A solid subtype is a kind of
    solid tile: its name, its composition (a material) and its hit points, since how much
    a solid can take depends on how much material is in it, its coverage (0-100, default
    100: how much of the cell the material fills, e.g. bars or a net; its opacity is the
    material's times this), and optionally the colours it's drawn in, fillColor and
    borderColor (any CSS colour, or a --variable from index.html), in place of the usual
    solid colours.
    
    Hole subtypes, also from init.json5, are kinds of hole tile: a name, a description and
    optionally a fillColor, drawn in place of the usual hole colour. */
(pkg => {
    'use strict';
    
    const isNum = v => Number.isFinite(v) && v >= 0,
        isText = v => v === undefined || typeof v === 'string',
        
        // An optional percentage: missing, or a number from 0 to 100.
        isPercent = v => v === undefined || (isNum(v) && v <= 100);
    
    let materials = new Map(), // id -> {id, name, hardness, density, opacity, description}
        subtypes = new Map(),  // id -> {id, name, composition, hp, coverage, description, fillColor, borderColor, material, dr, opacity}
        holeTypes = new Map(); // id -> {id, name, description, fillColor}
    
    pkg.solids = {
        /*  Replaces the materials and subtypes with those given, as init.json5 has them:
            {id:{name, hardness, density, opacity, description}} and
            {id:{name, composition, hp, coverage, description, fillColor, borderColor}}. An
            entry that isn't usable is left out, with a console error saying why. */
        define: (materialData, subtypeData) => {
            materials = new Map();
            subtypes = new Map();
            for (const [id, m] of Object.entries(materialData ?? {})) {
                if (typeof m?.name !== 'string' || !isNum(m.hardness) || !(m.density === undefined || isNum(m.density)) || !isPercent(m.opacity) || !isText(m.description)) {
                    console.error('Bad material', id);
                } else {
                    materials.set(id, {id, name:m.name, hardness:m.hardness, density:m.density ?? 0, opacity:m.opacity ?? 100, description:m.description ?? ''});
                }
            }
            for (const [id, s] of Object.entries(subtypeData ?? {})) {
                const material = materials.get(s?.composition);
                if (typeof s?.name !== 'string' || !material || !Number.isInteger(s.hp) || s.hp < 1 || !isPercent(s.coverage) ||
                    !isText(s.description) || !isText(s.fillColor) || !isText(s.borderColor)) {
                    console.error('Bad solid', id);
                } else {
                    const coverage = s.coverage ?? 100;
                    subtypes.set(id, {
                        id, name:s.name, composition:s.composition, hp:s.hp, coverage, description:s.description ?? '',
                        fillColor:s.fillColor || null, borderColor:s.borderColor || null,
                        material, dr:material.hardness, opacity:material.opacity * coverage / 100
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
    
    pkg.holes = {
        /*  Replaces the hole subtypes with those given, as init.json5 has them:
            {id:{name, description, fillColor}}. An entry that isn't usable is left out, with a console
            error saying why. */
        define: data => {
            holeTypes = new Map();
            for (const [id, h] of Object.entries(data ?? {})) {
                if (typeof h?.name !== 'string' || !isText(h.description) || !isText(h.fillColor)) {
                    console.error('Bad hole', id);
                } else {
                    holeTypes.set(id, {id, name:h.name, description:h.description ?? '', fillColor:h.fillColor || null});
                }
            }
        },
        
        /*  A hole subtype by id, or undefined. */
        get: id => holeTypes.get(id),
        
        /*  Every hole subtype, in the order init.json5 lists them. */
        list: () => [...holeTypes.values()]
    };
})(hc);
