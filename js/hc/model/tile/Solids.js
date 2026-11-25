/*  Materials and solid and hole subtypes, from data/init.json5 (see Subtypes.js).
    
    A material has a hardness, which is the damage reduction (dr) of anything made of it,
    a density (not used yet) and an opacity (0-100, default 100: how much it blocks sight).
    
    A solid subtype is a kind of solid tile: its composition (a material) and its hit
    points, since how much a solid can take depends on how much material is in it, its
    coverage (0-100, default 100: how much of the cell the material fills, e.g. bars or a
    net; its opacity is the material's times this), and optionally the colours it's drawn
    in, fillColor and borderColor (any CSS colour, or a --variable from index.html), in
    place of the usual solid colours, and floor: the floor subtype it leaves when it's
    broken (else the map's base floor; one that isn't known counts as none).
    
    A hole subtype is a kind of hole tile: optionally a fillColor, drawn in place of the
    usual hole colour.
    
    A floor subtype is a kind of floor tile: open floor that's harder (or easier) going,
    like mud, ice or loose stone. It doesn't block sight or movement, but stepping onto it
    costs its moveCost (default 1) times an action (see Combat.moveCost); fillColor is the
    colour it's drawn in (else the usual floor). A cell with no tile is plain floor.
    
    Either may have a shadowLength: how long its shadow is, in hexes (how tall a solid is,
    or how deep a hole), else cfg.SHADOW's length. The light the shadows come from is
    init.json5's "shadow" (see defineShadow). */
(pkg => {
    'use strict';
    
    const {Subtypes} = pkg,
        {isNum, isText, isPercent} = Subtypes,
        
        // {id:{name, hardness, density, opacity, description}}
        materials = new Subtypes('material', m => isNum(m.hardness) && (m.density === undefined || isNum(m.density)) && isPercent(m.opacity)
            ? {hardness:m.hardness, density:m.density ?? 0, opacity:m.opacity ?? 100}
            : null
        ),
        
        // A shadowLength, if given, must be a number of hexes, not below 0.
        isLength = v => v === undefined || (isNum(v) && v >= 0),
        
        // {id:{name, composition, hp, coverage, description, fillColor, borderColor, shadowLength, floor}}
        parseSolid = s => {
            const material = materials.get(s.composition);
            let own = null;
            if (material && Number.isInteger(s.hp) && s.hp >= 1 && isPercent(s.coverage) && isText(s.fillColor) && isText(s.borderColor) && isLength(s.shadowLength) && isText(s.floor)) {
                const coverage = s.coverage ?? 100;
                own = {
                    composition:s.composition, hp:s.hp, coverage,
                    fillColor:s.fillColor || null, borderColor:s.borderColor || null, shadowLength:s.shadowLength ?? null, floor:s.floor || null,
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
    
    // {id:{name, description, fillColor, moveCost}}
    pkg.floors = new Subtypes('floor', f => isText(f.fillColor) && (f.moveCost === undefined || (isNum(f.moveCost) && f.moveCost >= 0.1))
        ? {fillColor:f.fillColor || null, moveCost:f.moveCost ?? 1}
        : null);
    
    // {id:{name, description, fillColor, shadowLength}}
    pkg.holes = new Subtypes('hole', h => isText(h.fillColor) && isLength(h.shadowLength)
        ? {fillColor:h.fillColor || null, shadowLength:h.shadowLength ?? null}
        : null);
    
    /*  Sets the light shadows come from (cfg.SHADOW: angle, color, blur, length) from
        init.json5's "shadow", {id:value}: those given that are usable, with a warning for
        any that aren't. */
    pkg.defineShadow = data => {
        const shadow = pkg.cfg.SHADOW,
            ok = {angle:isNum, color:v => typeof v === 'string' && v !== '', blur:v => isNum(v) && v >= 0, length:v => isNum(v) && v >= 0};
        for (const [id, value] of Object.entries(data ?? {})) {
            if (ok[id]?.(value)) {
                shadow[id] = value;
            } else {
                console.warn('init.json5 shadow', id, 'cannot be', value);
            }
        }
    };
})(hc);
