/*  Materials and solid and hole subtypes, from data/init.json5 (see Subtypes.js).
    
    A material has a hardness, which is the damage reduction (dr) of anything made of it,
    a density (not used yet) and an opacity (0-100, default 100: how much it blocks sight).
    
    A solid subtype is a kind of solid tile: its composition (a material) and its hit
    points, since how much a solid can take depends on how much material is in it, its
    coverage (0-100, default 100: how much of the cell the material fills, e.g. bars or a
    net; its opacity is the material's times this), and optionally the colours it's drawn
    in, fillColor and borderColor (any CSS colour, or a --variable from index.html), in
    place of the usual solid colours.
    
    A hole subtype is a kind of hole tile: optionally a fillColor, drawn in place of the
    usual hole colour. */
(pkg => {
    'use strict';
    
    const {Subtypes} = pkg,
        {isNum, isText, isPercent} = Subtypes,
        
        // {id:{name, hardness, density, opacity, description}}
        materials = new Subtypes('material', m => isNum(m.hardness) && (m.density === undefined || isNum(m.density)) && isPercent(m.opacity)
            ? {hardness:m.hardness, density:m.density ?? 0, opacity:m.opacity ?? 100}
            : null
        ),
        
        // {id:{name, composition, hp, coverage, description, fillColor, borderColor}}
        parseSolid = s => {
            const material = materials.get(s.composition);
            let own = null;
            if (material && Number.isInteger(s.hp) && s.hp >= 1 && isPercent(s.coverage) && isText(s.fillColor) && isText(s.borderColor)) {
                const coverage = s.coverage ?? 100;
                own = {
                    composition:s.composition, hp:s.hp, coverage,
                    fillColor:s.fillColor || null, borderColor:s.borderColor || null,
                    material, dr:material.hardness, opacity:material.opacity * coverage / 100
                };
            }
            return own;
        };
    
    /*  The solid subtypes, which also keep the materials: define(materialData, data) takes
        both, and getMaterial(id) gives a material. */
    pkg.solids = new (new JS.Class('SolidSubtypes', Subtypes, {
        define: function(materialData, data) {
            materials.define(materialData);
            this.callSuper(data);
        },
        getMaterial: function(id) {return materials.get(id);}
    }))('solid', parseSolid);
    
    // {id:{name, description, fillColor}}
    pkg.holes = new Subtypes('hole', h => isText(h.fillColor) ? {fillColor:h.fillColor || null} : null);
})(hc);
