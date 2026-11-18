import {
    OFFICE_PAGE_DIMENSION,
    OFFICE_XML_MAX_BYTES,
    SLIDE_MAX_PICTURES,
    SLIDE_MAX_SHAPES,
    SLIDE_TEXT_MAX_CHARACTERS,
} from './config.js';
import {
    TOKEN,
    attributesOf,
    decodeEntities,
    openArchive,
    readPicture,
    readRelationships,
    readStoredThumbnail,
    readThemeColors,
} from './ooxml.js';
import { drawParagraph } from './page.js';

const EMUS_PER_POINT = 12700;
const DEFAULT_FONT_SIZE = 18;
// A text box keeps its text this far from its edges unless it says otherwise.
const DEFAULT_INSETS = { left: 7.2, top: 3.6, right: 7.2, bottom: 3.6 };
const COLOR_ELEMENTS = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr']);
const COLOR_CHANGES = new Set(['a:lumMod', 'a:lumOff', 'a:tint', 'a:shade']);
const PRESET_COLORS = { black: '000000', white: 'FFFFFF' };
const ALIGNMENTS = { l: 'start', ctr: 'center', r: 'end', just: 'start', dist: 'start' };
// The shapes whose outline is close enough to their box, or to the ellipse inside it, to fill as one.
const BOX_SHAPES = /^(rect|roundRect|round\d\w*Rect|snip\w*Rect|flowChartProcess)$/;

/**
 * @typedef {Object} SlideColor A color as the markup states it, before the theme gives it a value.
 * @property {string} name The element that states it.
 * @property {string} [hex]
 * @property {string} [scheme] A name the theme, or the master's color map, gives a color to.
 * @property {Array<[string, number]>} changes Lighter or darker versions to take of it, in order.
 */

/**
 * @typedef {Object} SlideLevel What text at one list level looks like, as far as a part says.
 * @property {number} [size] In points.
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {SlideColor} [color]
 * @property {'start' | 'center' | 'end'} [align]
 * @property {number} [indent] Where the text starts, in points from the box's edge.
 * @property {number} [hanging] Where the first line's marker starts, in points from the text. Negative.
 * @property {string | null} [bullet] The marker, or `null` for none.
 * @property {{ percent?: number, points?: number }} [spaceBefore]
 */

/**
 * @typedef {Object} SlideShape A shape or picture of a slide, a layout or a master. Lengths are in points.
 * @property {{ x: number, y: number, width: number, height: number }} [box] Absent on a placeholder that takes its
 *     position from the layout or the master.
 * @property {{ type?: string, index?: string }} [placeholder]
 * @property {string} [geometry]
 * @property {SlideColor | null} [fill] `null` when the shape says it has none.
 * @property {SlideColor} [styleFill] The fill its style gives it when it states none.
 * @property {SlideColor} [styleColor] The text color its style gives it.
 * @property {string} [picture] The entry that holds its picture.
 * @property {{
 *     paragraphs: Array<SlideLevel & { level: number, runs: Array<SlideLevel & { text: string }>, endSize?: number }>,
 *     levels: SlideLevel[],
 *     anchor?: string,
 *     insets: Partial<typeof DEFAULT_INSETS>,
 *     scale: number,
 * }} [text]
 */

const pointsOf = (emus) => {
    const points = Number(emus) / EMUS_PER_POINT;
    return Number.isFinite(points) ? points : undefined;
};

const flagOf = value => (value === undefined ? undefined : value === '1' || value === 'true');

// Copy what a run, or a level's default for runs, says about its text. A property it doesn't state is left to inherit.
const readTextProperties = (target, { sz, b, i }) => {
    const size = Number(sz) / 100;
    if ( size >= 1 && size <= 4000 ) target.size = size;
    if ( b !== undefined ) target.bold = flagOf(b);
    if ( i !== undefined ) target.italic = flagOf(i);
};

const readParagraphProperties = (target, { algn, marL, indent }) => {
    if ( ALIGNMENTS[algn] ) target.align = ALIGNMENTS[algn];
    if ( pointsOf(marL) !== undefined ) target.indent = Math.max(0, pointsOf(marL));
    if ( pointsOf(indent) !== undefined ) target.hanging = pointsOf(indent);
};

/**
 * Read a slide, a layout or a master: its background, its shapes in drawing order, and the text styles a master sets.
 *
 * @param {string} xml
 * @param {Map<string, { target: string, type: string }>} relationships The part's own, which name its pictures.
 */
const readPart = (xml, relationships) => {
    const part = {
        /** @type {SlideColor | undefined} */
        background: undefined,
        /** @type {string | undefined} */
        backgroundPicture: undefined,
        /** @type {Record<string, string> | undefined} */
        colorMap: undefined,
        showsMasterShapes: true,
        /** @type {SlideShape[]} */
        shapes: [],
        textStyles: { title: [], body: [], other: [] },
    };
    const path = [];
    // The open groups, outermost first. A group places its children in a space of its own.
    const groups = [];
    let shape;
    let levels;
    let level;
    let paragraph;
    let run;
    let color;
    let skipped;
    let skipDepth = 0;
    let characters = 0;

    const closeShape = () => {
        if ( ! shape ) return;
        const { groups: inside, x, y, width, height, ...rest } = shape;
        let box = [x, y, width, height].includes(undefined) ? undefined : { x, y, width, height };
        for ( const group of inside.slice().reverse() ) {
            if ( !box || !group.childWidth || !group.childHeight || group.width === undefined || group.x === undefined ) continue;
            const scaleX = group.width / group.childWidth;
            const scaleY = group.height / group.childHeight;
            box = {
                x: group.x + (box.x - (group.childX ?? 0)) * scaleX,
                y: group.y + (box.y - (group.childY ?? 0)) * scaleY,
                width: box.width * scaleX,
                height: box.height * scaleY,
            };
        }
        part.shapes.push({ ...rest, box });
        shape = paragraph = run = levels = level = undefined;
    };

    for ( const [, closing, name, source, empty, text] of xml.matchAll(TOKEN) ) {
        if ( skipped ) {
            if ( name === skipped && !empty ) skipDepth += closing ? -1 : 1;
            if ( ! skipDepth ) skipped = undefined;
            continue;
        }
        if ( ! name ) {
            if ( run && path.at(-1) === 'a:t' ) {
                const shown = decodeEntities(text).slice(0, SLIDE_TEXT_MAX_CHARACTERS - characters);
                run.text += shown;
                characters += shown.length;
            }
            continue;
        }
        if ( closing ) {
            path.pop();
            if ( name === 'p:sp' || name === 'p:pic' ) {
                closeShape();
            } else if ( name === 'p:grpSp' ) {
                groups.pop();
            } else if ( name === 'a:p' && paragraph ) {
                shape.text.paragraphs.push(paragraph);
                paragraph = undefined;
            } else if ( (name === 'a:r' || name === 'a:fld') && run ) {
                if ( run.text ) paragraph.runs.push(run);
                run = undefined;
            } else if ( name === 'a:lstStyle' || name.endsWith('Style') ) {
                levels = undefined;
            } else if ( /^a:lvl\dpPr$/.test(name) ) {
                level = undefined;
            } else if ( name === color?.name ) {
                color = undefined;
            }
            continue;
        }
        // The version of some content kept for older readers.
        if ( !empty && name === 'mc:Fallback' ) {
            skipped = name;
            skipDepth = 1;
            continue;
        }

        const [filled, , holder, parent] = [path.at(-4), path.at(-3), path.at(-2), path.at(-1)];
        if ( ! empty ) path.push(name);
        if ( COLOR_ELEMENTS.has(name) ) {
            const { val, lastClr } = attributesOf(source);
            const stated = { name, changes: [] };
            if ( name === 'a:schemeClr' ) stated.scheme = val;
            else stated.hex = name === 'a:sysClr' ? lastClr : name === 'a:prstClr' ? PRESET_COLORS[val] : val;
            if ( parent === 'a:solidFill' ) {
                if ( holder === 'p:spPr' && shape ) shape.fill = stated;
                else if ( holder === 'p:bgPr' ) part.background = stated;
                else if ( holder === 'a:rPr' && run ) run.color = stated;
                else if ( holder === 'a:defRPr' && level ) level.color = stated;
            } else if ( parent === 'a:gs' ) {
                // A gradient is drawn as its first color.
                if ( filled === 'p:spPr' && shape && shape.fill === undefined ) shape.fill = stated;
                else if ( filled === 'p:bgPr' ) part.background ??= stated;
            } else if ( parent === 'p:bgRef' ) {
                part.background = stated;
            } else if ( parent === 'a:fillRef' && shape?.usesStyleFill ) {
                shape.styleFill = stated;
            } else if ( parent === 'a:fontRef' && shape ) {
                shape.styleColor = stated;
            }
            if ( ! empty ) color = stated;
        } else if ( COLOR_CHANGES.has(name) ) {
            const amount = Number(attributesOf(source).val) / 100000;
            if ( color && parent === color.name && Number.isFinite(amount) ) color.changes.push([name, amount]);
        } else if ( name === 'p:sld' || name === 'p:sldLayout' || name === 'p:sldMaster' ) {
            if ( attributesOf(source).showMasterSp === '0' ) part.showsMasterShapes = false;
        } else if ( name === 'p:clrMap' || name === 'a:overrideClrMapping' ) {
            part.colorMap = attributesOf(source);
        } else if ( name === 'p:grpSp' ) {
            if ( ! empty ) groups.push({});
        } else if ( name === 'p:sp' || name === 'p:pic' ) {
            if ( !empty && part.shapes.length < SLIDE_MAX_SHAPES ) shape = { groups: groups.slice() };
        } else if ( parent === 'a:xfrm' ) {
            const target = holder === 'p:grpSpPr' ? groups.at(-1) : holder === 'p:spPr' ? shape : undefined;
            const { x, y, cx, cy } = attributesOf(source);
            if ( ! target ) continue;
            if ( name === 'a:off' ) Object.assign(target, { x: pointsOf(x), y: pointsOf(y) });
            else if ( name === 'a:ext' ) Object.assign(target, { width: pointsOf(cx), height: pointsOf(cy) });
            else if ( name === 'a:chOff' ) Object.assign(target, { childX: pointsOf(x), childY: pointsOf(y) });
            else if ( name === 'a:chExt' ) Object.assign(target, { childWidth: pointsOf(cx), childHeight: pointsOf(cy) });
        } else if ( name === 'a:blip' ) {
            const picture = relationships.get(attributesOf(source)['r:embed'])?.target;
            if ( holder === 'p:bgPr' ) part.backgroundPicture = picture;
            else if ( shape && (holder === 'p:pic' || holder === 'p:spPr') ) shape.picture = picture;
        } else if ( ! shape ) {
            // Everything below describes the open shape, or the text styles of a master.
            if ( parent === 'p:txStyles' && !empty ) levels = part.textStyles[name.slice(2, -5)];
        } else if ( name === 'p:ph' && parent === 'p:nvPr' ) {
            const { type, idx } = attributesOf(source);
            shape.placeholder = { type, index: idx };
        } else if ( parent === 'p:spPr' ) {
            if ( name === 'a:prstGeom' ) shape.geometry = attributesOf(source).prst;
            else if ( name === 'a:custGeom' ) shape.geometry = 'custom';
            else if ( name === 'a:noFill' ) shape.fill = null;
        } else if ( name === 'a:fillRef' && parent === 'p:style' ) {
            shape.usesStyleFill = Number(attributesOf(source).idx) > 0;
        } else if ( name === 'p:txBody' ) {
            shape.text = { paragraphs: [], levels: [], anchor: undefined, insets: {}, scale: 1 };
        } else if ( ! shape.text ) {
            continue;
        } else if ( name === 'a:bodyPr' && parent === 'p:txBody' ) {
            const { anchor, lIns, tIns, rIns, bIns } = attributesOf(source);
            shape.text.anchor = anchor;
            for ( const [side, value] of [['left', lIns], ['top', tIns], ['right', rIns], ['bottom', bIns]] ) {
                if ( pointsOf(value) !== undefined ) shape.text.insets[side] = pointsOf(value);
            }
        } else if ( name === 'a:normAutofit' && parent === 'a:bodyPr' ) {
            // PowerPoint records how far it shrank the text to fit its box.
            const scale = Number(attributesOf(source).fontScale) / 100000;
            if ( scale > 0.1 && scale <= 1 ) shape.text.scale = scale;
        } else if ( name === 'a:lstStyle' && parent === 'p:txBody' ) {
            if ( ! empty ) levels = shape.text.levels;
        } else if ( name === 'a:p' && parent === 'p:txBody' ) {
            paragraph = { runs: [], level: 0 };
            if ( empty ) {
                shape.text.paragraphs.push(paragraph);
                paragraph = undefined;
            }
        } else if ( paragraph && parent === 'a:p' ) {
            const attributes = attributesOf(source);
            if ( name === 'a:pPr' ) {
                paragraph.level = Math.min(8, Math.max(0, Number(attributes.lvl) || 0));
                readParagraphProperties(paragraph, attributes);
            } else if ( name === 'a:r' || name === 'a:fld' ) {
                if ( ! empty ) run = { text: '' };
            } else if ( name === 'a:br' ) {
                paragraph.runs.push({ text: '\n' });
            } else if ( name === 'a:endParaRPr' ) {
                const mark = {};
                readTextProperties(mark, attributes);
                paragraph.endSize = mark.size;
            }
        } else if ( name === 'a:rPr' && run ) {
            readTextProperties(run, attributesOf(source));
        }

        // Paragraph and level properties are written the same way, on a paragraph or in a list of level styles.
        if ( levels && /^a:lvl\dpPr$/.test(name) ) {
            level = levels[Number(name[5]) - 1] ??= {};
            readParagraphProperties(level, attributesOf(source));
            if ( empty ) level = undefined;
        } else if ( level && name === 'a:defRPr' ) {
            readTextProperties(level, attributesOf(source));
        }
        const described = /^a:lvl\dpPr$/.test(parent) ? level : parent === 'a:pPr' ? paragraph : undefined;
        if ( described && (name === 'a:buNone' || name === 'a:buChar' || name === 'a:buAutoNum') ) {
            described.bullet = name === 'a:buNone' ? null : attributesOf(source).char || '•';
        }
        const spaced = /^a:lvl\dpPr$/.test(holder) ? level : holder === 'a:pPr' ? paragraph : undefined;
        if ( spaced && parent === 'a:spcBef' && (name === 'a:spcPct' || name === 'a:spcPts') ) {
            const amount = Number(attributesOf(source).val);
            if ( Number.isFinite(amount) ) {
                spaced.spaceBefore = name === 'a:spcPct' ? { percent: amount / 100000 } : { points: amount / 100 };
            }
        }
    }
    closeShape();
    return part;
};

// The CSS color of a color the markup states, once the theme and the master's map of names say what it is.
const colorOf = (stated, theme, colorMap) => {
    const hex = stated?.hex ?? theme[colorMap[stated?.scheme] ?? stated?.scheme];
    if ( ! /^[0-9a-f]{6}$/i.test(hex) ) return undefined;
    const channels = [0, 2, 4].map((at) => {
        let value = parseInt(hex.slice(at, at + 2), 16);
        for ( const [change, amount] of stated.changes ) {
            if ( change === 'a:lumOff' ) value += 255 * amount;
            else if ( change === 'a:tint' ) value = value * amount + 255 * (1 - amount);
            else value *= amount;
        }
        return Math.round(Math.min(255, Math.max(0, value)));
    });
    return `rgb(${channels.join(', ')})`;
};

// Titles of both kinds share a style, footers keep theirs, and every other placeholder is laid out as body text.
const kindOf = type => (type === 'title' || type === 'ctrTitle'
    ? 'title'
    : ['dt', 'ftr', 'sldNum'].includes(type) ? type : 'body');

/**
 * Get a small image of a PPTX's first slide: the thumbnail its editor stored in it, or else a drawing of the slide's
 * background, shapes, pictures and text, placed and styled as the slide, its layout and its master say.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when there is nothing to show.
 */
export const readPptxPreview = async (file, signal) => {
    const archive = await openArchive(file);
    if ( ! archive ) return undefined;
    const thumbnail = await readStoredThumbnail(archive);
    if ( thumbnail ) return thumbnail;

    const { entries, contentOf } = archive;
    const textOf = async name => (await contentOf(entries.get(name), OFFICE_XML_MAX_BYTES))?.text();
    const relationshipsOf = async (name = '') => {
        const folder = name.slice(0, name.lastIndexOf('/'));
        return readRelationships(await textOf(`${folder}/_rels/${name.slice(folder.length + 1)}.rels`), folder);
    };
    const relatedTo = (relationships, kind) =>
        [...relationships.values()].find(relationship => relationship.type.endsWith(`/${kind}`))?.target;

    // The presentation lists its slides in order, and its relationships say which part holds each one.
    const presentation = await textOf('ppt/presentation.xml');
    if ( !presentation || signal?.aborted ) return undefined;
    const presentationRelationships = await relationshipsOf('ppt/presentation.xml');
    const size = { width: 720, height: 540 };
    let slideName;
    for ( const [, closing, name, source] of presentation.matchAll(TOKEN) ) {
        if ( closing ) continue;
        if ( name === 'p:sldId' ) {
            slideName ??= presentationRelationships.get(attributesOf(source)['r:id'])?.target;
        } else if ( name === 'p:sldSz' ) {
            const { cx, cy } = attributesOf(source);
            for ( const [side, value] of [['width', pointsOf(cx)], ['height', pointsOf(cy)]] ) {
                if ( value >= 72 && value <= 4000 ) size[side] = value;
            }
        }
    }
    if ( ! slideName ) return undefined;

    // A slide builds on a layout, and the layout on a master, which names the theme.
    const read = async (name) => {
        const relationships = await relationshipsOf(name);
        return { relationships, part: readPart(name ? await textOf(name) ?? '' : '', relationships) };
    };
    const { part: slide, relationships: slideRelationships } = await read(slideName);
    const { part: layout, relationships: layoutRelationships } = await read(relatedTo(slideRelationships, 'slideLayout'));
    const { part: master, relationships: masterRelationships } = await read(relatedTo(layoutRelationships, 'slideMaster'));
    const theme = readThemeColors(await textOf(relatedTo(masterRelationships, 'theme')) ?? '');
    if ( signal?.aborted ) return undefined;
    const colorMap = { ...master.colorMap, ...layout.colorMap, ...slide.colorMap };
    const cssOf = stated => colorOf(stated, theme, colorMap);

    // A placeholder takes what it doesn't state from the layout's placeholder of the same number or kind, and that
    // one from the master's of the same kind.
    const placeholderIn = (part, { type, index }, byIndex) => part.shapes.find(({ placeholder }) => placeholder &&
        (byIndex && index !== undefined ? placeholder.index === index : kindOf(placeholder.type) === kindOf(type)));
    const resolve = (shape) => {
        const onLayout = shape.placeholder &&
            (placeholderIn(layout, shape.placeholder, true) ?? placeholderIn(layout, shape.placeholder, false));
        const type = shape.placeholder?.type ?? onLayout?.placeholder.type;
        const onMaster = shape.placeholder && placeholderIn(master, { type }, false);
        const sources = [shape, onLayout, onMaster].filter(Boolean);
        const box = sources.find(source => source.box)?.box;
        if ( ! box ) return undefined;
        const stated = sources.find(source => source.fill !== undefined)?.fill;
        const fill = cssOf(stated === undefined && !shape.placeholder ? shape.styleFill : stated);
        const resolved = { box, picture: shape.picture, fill, geometry: shape.geometry ?? 'rect' };
        if ( ! shape.text ) return resolved;

        const kind = shape.placeholder ? kindOf(type) : 'other';
        const styles = master.textStyles[kind === 'title' || kind === 'body' ? kind : 'other'];
        const styleColor = shape.placeholder ? undefined : cssOf(shape.styleColor);
        const textSources = sources.map(source => source.text).filter(Boolean).reverse();
        const paragraphs = shape.text.paragraphs.map((paragraph, index) => {
            const style = Object.assign({}, styles[paragraph.level] ?? styles[0],
                            ...textSources.map(source => source.levels[paragraph.level]), paragraph);
            const sizeOf = stated => (stated ?? style.size ?? DEFAULT_FONT_SIZE) * shape.text.scale;
            const runs = paragraph.runs.map(run => ({
                text: run.text,
                size: sizeOf(run.size),
                bold: run.bold ?? style.bold ?? false,
                italic: run.italic ?? style.italic ?? false,
                color: cssOf(run.color) ?? styleColor ?? cssOf(style.color) ?? cssOf({ scheme: 'tx1', changes: [] }) ?? '#000',
            }));
            const first = runs.find(run => run.text.trim());
            const before = index && style.spaceBefore
                ? style.spaceBefore.points ?? style.spaceBefore.percent * (first?.size ?? sizeOf()) * 1.2
                : 0;
            return {
                runs,
                size: sizeOf(paragraph.endSize),
                align: style.align ?? 'start',
                indent: style.indent ?? 0,
                spaceBefore: Math.min(400, Math.max(0, before || 0)),
                spaceAfter: 0,
                lineSpacing: 1,
                // A marker hangs in the space the indent leaves before the text.
                marker: first && style.bullet && style.hanging < 0
                    ? { text: style.bullet, offset: style.hanging, size: first.size, color: first.color }
                    : undefined,
            };
        });
        return {
            ...resolved,
            paragraphs,
            anchor: textSources.map(source => source.anchor).reverse().find(Boolean) ?? 't',
            insets: Object.assign({}, DEFAULT_INSETS, ...textSources.map(source => source.insets)),
        };
    };

    // What a layout and a master add to every slide is drawn under the slide's own shapes: everything of theirs that
    // is not a placeholder.
    const fixed = part => part.shapes.filter(shape => !shape.placeholder);
    const shapes = [
        ...(slide.showsMasterShapes && layout.showsMasterShapes ? fixed(master) : []),
        ...(slide.showsMasterShapes ? fixed(layout) : []),
        ...slide.shapes,
    ].map(resolve).filter(Boolean);
    const behind = [slide, layout, master].find(part => part.backgroundPicture || part.background);

    const bitmaps = new Map();
    try {
        for ( const name of [behind?.backgroundPicture, ...shapes.map(shape => shape.picture)] ) {
            if ( signal?.aborted ) return undefined;
            if ( !name || bitmaps.has(name) || bitmaps.size >= SLIDE_MAX_PICTURES ) continue;
            bitmaps.set(name, await readPicture(archive, name));
        }

        const scale = OFFICE_PAGE_DIMENSION / Math.max(size.width, size.height);
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(size.width * scale)),
                        Math.max(1, Math.round(size.height * scale)));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = cssOf(behind?.background) ?? '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // Drawing in points keeps positions and font sizes as the slide states them.
        ctx.scale(scale, scale);
        ctx.textAlign = 'left';
        let drawn = false;
        const backdrop = bitmaps.get(behind?.backgroundPicture);
        if ( backdrop ) {
            ctx.drawImage(backdrop, 0, 0, size.width, size.height);
            drawn = true;
        }
        for ( const { box, fill, geometry, picture, paragraphs, anchor, insets } of shapes ) {
            if ( fill && (BOX_SHAPES.test(geometry) || geometry === 'ellipse') ) {
                ctx.fillStyle = fill;
                ctx.beginPath();
                if ( geometry === 'ellipse' ) {
                    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, 2 * Math.PI);
                } else {
                    ctx.rect(box.x, box.y, box.width, box.height);
                }
                ctx.fill();
                drawn = true;
            }
            if ( bitmaps.get(picture) ) {
                ctx.drawImage(bitmaps.get(picture), box.x, box.y, box.width, box.height);
                drawn = true;
            }
            if ( ! paragraphs ) continue;
            const left = box.x + insets.left;
            const width = Math.max(1, box.width - insets.left - insets.right);
            // The text is laid out once to find its height, which says where it starts in a box that centers it or
            // sets it at the bottom, and once more to draw it.
            const layOut = (top, paint) => paragraphs.reduce((y, paragraph) => {
                const laidOut = drawParagraph(ctx, paragraph, left, width, y, paint ? size.height : Infinity, paint);
                drawn ||= paint && laidOut.drawn;
                return laidOut.bottom;
            }, top);
            const free = box.height - insets.top - insets.bottom - layOut(0, false);
            layOut(box.y + insets.top + (anchor === 'ctr' ? free / 2 : anchor === 'b' ? free : 0), true);
        }
        // A slide with nothing on it keeps the file icon.
        if ( ! drawn ) return undefined;
        return new File([await canvas.convertToBlob({ type: 'image/png' })], 'preview.png', { type: 'image/png' });
    } finally {
        for ( const bitmap of bitmaps.values() ) bitmap?.close();
    }
};
