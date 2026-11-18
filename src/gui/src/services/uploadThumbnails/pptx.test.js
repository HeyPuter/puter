import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas, linesOf } from '../../../tests/fixtures/canvas.js';
import { createZip, pngHeader } from '../../../tests/fixtures/docx.js';
import { createPptx, frame, group, paragraph, pictureShape, shape, solid } from '../../../tests/fixtures/pptx.js';
import { OFFICE_PICTURE_MAX_PIXELS, SLIDE_MAX_PICTURES, SLIDE_MAX_SHAPES, SLIDE_TEXT_MAX_CHARACTERS } from './config.js';
import { readPptxPreview } from './pptx.js';

const pptxFile = options => new File([createPptx(options)], 'deck.pptx');
const sized = (size, properties = '') => ({ runProperties: `<a:rPr sz="${size * 100}" ${properties}/>` });
// The fills of shapes: every fill but the slide's background, which is first.
const shapeFills = () => drawn.fills.slice(1);
const titleStyle = '<p:titleStyle><a:lvl1pPr algn="ctr"><a:buNone/><a:defRPr sz="4000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>';
// Lengths here are in EMUs: 342900 is 27 points.
const bodyStyle = '<p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:spcBef><a:spcPct val="50000"/></a:spcBef><a:buChar char="•"/><a:defRPr sz="2000"/></a:lvl1pPr>' +
    '<a:lvl2pPr marL="685800" indent="-342900"><a:buChar char="–"/><a:defRPr sz="1000" i="1"/></a:lvl2pPr></p:bodyStyle>';
let drawn;
let bitmaps;
/** Draw a deck's first slide and return its lines of text. */
const draw = async (options) => {
    const preview = await readPptxPreview(pptxFile(options));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return linesOf(drawn);
};

beforeEach(() => {
    const canvas = createRecordingCanvas();
    drawn = canvas.drawn;
    bitmaps = [];
    vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
    vi.stubGlobal('createImageBitmap', vi.fn(async (blob) => {
        const bitmap = { bytes: (await blob.arrayBuffer()).byteLength, close: vi.fn() };
        bitmaps.push(bitmap);
        return bitmap;
    }));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('readPptxPreview with a stored thumbnail', () => {
    it('returns the thumbnail the editor stored', async () => {
        const jpeg = Uint8Array.from({ length: 3000 }, (_, index) => index * 7 % 256);
        const preview = await readPptxPreview(pptxFile({ thumbnail: jpeg }));
        expect(preview.type).toBe('image/jpeg');
        expect(new Uint8Array(await preview.arrayBuffer())).toEqual(jpeg);
        expect(drawn.text).toEqual([]);
    });
});

describe('readPptxPreview drawing the first slide', () => {
    it('draws on a canvas of the slide\'s shape, and of the default shape for a deck that states no size', async () => {
        await draw({ size: [960, 540] });
        expect(drawn).toMatchObject({ width: 256, height: 144 });
        await draw({ size: undefined });
        expect(drawn).toMatchObject({ width: 256, height: 192 });
    });

    it('draws the slide the presentation lists first, whatever its part is called', async () => {
        const lines = await draw({
            firstSlide: 'slide2',
            slide: { shapes: shape({ box: [0, 0, 300, 60], text: paragraph('Second in the deck') }) },
            slides: [{ shapes: shape({ box: [0, 0, 300, 60], text: paragraph('First in the deck') }) }],
        });
        expect(lines.map(line => line.text)).toEqual(['First in the deck']);
    });

    it('fills box-like shapes and ellipses where they are, and no other outline', async () => {
        await draw({
            slide: {
                shapes: shape({ box: [10, 20, 100, 50], fill: solid('FF0000') }) +
                    shape({ box: [200, 20, 80, 40], fill: solid('00FF00'), geometry: 'ellipse' }) +
                    shape({ box: [300, 20, 80, 40], fill: solid('0000FF'), geometry: 'roundRect' }) +
                    shape({ box: [400, 20, 80, 40], fill: solid('123456'), geometry: 'rightArrow', text: paragraph('Arrow') }) +
                    shape({ box: [500, 20, 80, 40], fill: '<a:noFill/>', style: `<p:style><a:fillRef idx="1">${solid('accent1').slice(13, -14)}</a:fillRef></p:style>` }) +
                    shape({ box: [10, 200, 80, 40], fill: `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="AA0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000AA"/></a:gs></a:gsLst></a:gradFill>` }),
            },
        });
        expect(shapeFills()).toEqual([
            { x: 10, y: 20, width: 100, height: 50, color: 'rgb(255, 0, 0)' },
            { x: 200, y: 20, width: 80, height: 40, color: 'rgb(0, 255, 0)', ellipse: true },
            { x: 300, y: 20, width: 80, height: 40, color: 'rgb(0, 0, 255)' },
            { x: 10, y: 200, width: 80, height: 40, color: 'rgb(170, 0, 0)' },
        ]);
        expect(drawn.text.map(word => word.text)).toEqual(['Arrow']);
    });

    it('gives a shape with no fill of its own the fill and the text color of its style', async () => {
        const style = '<p:style><a:lnRef idx="1"><a:schemeClr val="accent2"/></a:lnRef><a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>' +
            '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>';
        const lines = await draw({
            slide: {
                shapes: shape({ box: [10, 10, 200, 60], style, text: paragraph('Styled') }) +
                    // An index of zero means the style gives no fill.
                    shape({ box: [10, 100, 200, 60], style: style.replace('idx="3"', 'idx="0"'), text: paragraph('Plain') }),
            },
        });
        expect(shapeFills()).toEqual([{ x: 10, y: 10, width: 200, height: 60, color: 'rgb(79, 129, 189)' }]);
        expect(lines.map(line => line.color)).toEqual(['rgb(255, 255, 255)', 'rgb(255, 255, 255)']);
    });

    it('draws a shape\'s text in its runs\' formatting, inside the box\'s insets', async () => {
        const lines = await draw({
            slide: {
                shapes: shape({
                    box: [100, 50, 200, 100],
                    text: `<a:p><a:r><a:rPr sz="2000" b="1" i="1">${solid('FF0000')}</a:rPr><a:t>Big </a:t></a:r>` +
                        '<a:r><a:rPr sz="1000" b="0"/><a:t>small</a:t></a:r><a:br/><a:fld type="slidenum"><a:rPr sz="1000"/><a:t>7</a:t></a:fld></a:p>',
                }) + shape({ box: [100, 300, 200, 100], body: 'lIns="254000" tIns="127000"', text: paragraph('Inset', sized(10)) }),
            },
        });
        expect(lines.slice(0, 2).map(line => line.text)).toEqual(['Big small', '7']);
        expect(drawn.text.slice(0, 3).map(({ font, color }) => [font, color])).toEqual([
            ['italic bold 20px sans-serif', 'rgb(255, 0, 0)'], ['10px sans-serif', 'rgb(0, 0, 0)'], ['10px sans-serif', 'rgb(0, 0, 0)'],
        ]);
        // The default insets are 7.2 points at the sides and 3.6 above; the second box states 20 and 10.
        expect(lines[0].x).toBe(100 + 7.2);
        expect(lines[0].y).toBeCloseTo(50 + 3.6 + 20 * 1.2 - 5);
        expect(lines[2]).toMatchObject({ text: 'Inset', x: 100 + 20 });
        expect(lines[2].y).toBeCloseTo(300 + 10 + 10 * 1.2 - 2.5);
    });

    it('wraps text to its box and sets it at the top, the middle or the bottom', async () => {
        // At 10 points a character is 5 wide and a line 12 tall. The box is 100 wide inside its insets.
        const text = paragraph('aaaa bbbb cccc dddd eeee ffff', sized(10));
        const lines = await draw({
            slide: {
                shapes: shape({ box: [0, 0, 114.4, 207.2], text }) +
                    shape({ box: [200, 0, 114.4, 207.2], body: 'anchor="ctr"', text }) +
                    shape({ box: [400, 0, 114.4, 207.2], body: 'anchor="b"', text }),
            },
        });
        const column = x => lines.filter(line => Math.abs(line.x - x) < 1);
        expect(column(7.2).map(line => line.text)).toEqual(['aaaa bbbb cccc dddd', 'eeee ffff']);
        // Two lines are 24 tall in the 200 the box leaves: 0, 88 and 176 above them.
        expect(column(7.2)[0].y).toBeCloseTo(3.6 + 12 - 2.5);
        expect(column(207.2)[0].y).toBeCloseTo(3.6 + 88 + 12 - 2.5);
        expect(column(407.2)[0].y).toBeCloseTo(3.6 + 176 + 12 - 2.5);
    });

    it('aligns paragraphs and applies the shrink PowerPoint recorded for text that did not fit', async () => {
        const lines = await draw({
            slide: {
                shapes: shape({
                    box: [0, 0, 214.4, 100],
                    body: 'anchor="t"><a:normAutofit fontScale="50000"/></a:bodyPr><a:bodyPr',
                    text: paragraph('left', sized(20)) + paragraph('mid', { ...sized(20), properties: '<a:pPr algn="ctr"/>' }) +
                        paragraph('right', { ...sized(20), properties: '<a:pPr algn="r"/>' }),
                }),
            },
        });
        // Text of 20 points is drawn at 10, so a character is 5 wide.
        expect(lines.map(line => [line.text, line.font, Math.round(line.x * 100) / 100])).toEqual([
            ['left', '10px sans-serif', 7.2], ['mid', '10px sans-serif', 99.7], ['right', '10px sans-serif', 182.2],
        ]);
    });
});

describe('readPptxPreview with what a slide takes from its layout and master', () => {
    const master = {
        shapes: shape({ placeholder: 'type="title"', box: [40, 20, 640, 80], body: 'anchor="b"', text: paragraph('Master title prompt') }) +
            shape({ placeholder: 'type="body" idx="1"', box: [40, 120, 640, 300], text: paragraph('Master body prompt') }) +
            shape({ placeholder: 'type="sldNum" idx="12"', box: [600, 500, 100, 30], levels: '<a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr>', text: paragraph('#') }),
        textStyles: titleStyle + bodyStyle,
    };

    it('places a placeholder where its layout does, or else its master, and styles its text as they say', async () => {
        const lines = await draw({
            slide: {
                shapes: shape({ placeholder: 'type="title"', text: paragraph('Title') }) +
                    shape({ placeholder: 'idx="1"', text: paragraph('Body') }) +
                    shape({ placeholder: 'type="sldNum" idx="12"', text: paragraph('3') }),
            },
            layout: {
                // The layout moves the title and makes it smaller, and leaves the body and the number to the master.
                shapes: shape({ placeholder: 'type="title"', box: [100, 200, 400, 60], levels: '<a:lvl1pPr><a:defRPr sz="3000"/></a:lvl1pPr>', text: paragraph('Layout title prompt') }) +
                    shape({ placeholder: 'idx="1"', text: paragraph('Layout body prompt') }),
            },
            master,
        });
        const byText = Object.fromEntries(lines.map(line => [line.text, line]));
        // Only the slide's own text is drawn, never a prompt.
        expect(Object.keys(byText).sort()).toEqual(['3', 'Title', '• Body']);
        // The title is centered in the layout's box, bold in the master's color for titles, at the layout's size,
        // and set at the bottom as the master's placeholder says.
        expect(byText.Title).toMatchObject({ font: 'bold 30px sans-serif', color: 'rgb(31, 73, 125)' });
        expect(byText.Title.x).toBeCloseTo(100 + 7.2 + (400 - 14.4 - 75) / 2);
        expect(byText.Title.y).toBeCloseTo(200 + 60 - 3.6 - 7.5);
        // The body's text starts 27 points into the master's box, after its marker.
        expect(drawn.text.find(word => word.text === 'Body')).toMatchObject({ font: '20px sans-serif', color: 'rgb(0, 0, 0)', x: 40 + 7.2 + 27 });
        expect(byText['3'].font).toBe('12px sans-serif');
        expect(byText['3'].x).toBeCloseTo(600 + 100 - 7.2 - 6);
    });

    it('matches a title to a centered title, and a numbered placeholder by its number before its kind', async () => {
        const lines = await draw({
            slide: {
                shapes: shape({ placeholder: 'type="title"', text: paragraph('Title', sized(10)) }) +
                    shape({ placeholder: 'type="body" idx="2"', text: paragraph('Second', sized(10)) }),
            },
            layout: {
                shapes: shape({ placeholder: 'type="ctrTitle"', box: [0, 300, 200, 50], text: paragraph('prompt') }) +
                    shape({ placeholder: 'type="body" idx="1"', box: [0, 0, 200, 50], text: paragraph('prompt') }) +
                    shape({ placeholder: 'type="body" idx="2"', box: [400, 0, 200, 50], text: paragraph('prompt') }),
            },
        });
        const byText = Object.fromEntries(lines.map(line => [line.text, line]));
        expect(byText.Title.y).toBeGreaterThan(300);
        expect(byText.Second.x).toBe(400 + 7.2);
    });

    it('draws list markers and levels as the master\'s body style sets them', async () => {
        const lines = await draw({
            slide: {
                shapes: shape({
                    placeholder: 'idx="1"',
                    text: paragraph('One') + paragraph('Two') + paragraph('Nested', { properties: '<a:pPr lvl="1"/>' }) +
                        paragraph('Bare', { properties: '<a:pPr><a:buNone/></a:pPr>' }) + paragraph('', { properties: '<a:pPr/>' }),
                }),
            },
            master,
        });
        expect(lines.map(line => line.text)).toEqual(['• One', '• Two', '– Nested', 'Bare']);
        const xOf = Object.fromEntries(drawn.text.map(word => [word.text, word.x]));
        // The marker hangs 27 points before the text, which starts 27 or 54 points into the box.
        expect([xOf['•'], xOf.One, xOf['–'], xOf.Nested, xOf.Bare].map(x => Math.round(x * 100) / 100)).toEqual([47.2, 74.2, 74.2, 101.2, 74.2]);
        expect(drawn.text.find(word => word.text === 'Nested').font).toBe('italic 10px sans-serif');
        // Half a line of space before each paragraph but the first: 20 point lines are 24 tall.
        expect(lines[1].y - lines[0].y).toBeCloseTo(24 + 12);
    });

    it('draws what the master and the layout add to every slide under the slide\'s own shapes', async () => {
        const lines = await draw({
            slide: { shapes: shape({ box: [0, 0, 100, 40], fill: solid('0000FF'), text: paragraph('Slide', sized(10)) }) },
            layout: { shapes: shape({ box: [0, 100, 100, 40], fill: solid('00FF00'), text: paragraph('Layout', sized(10)) }) },
            master: { shapes: shape({ box: [0, 200, 100, 40], fill: solid('FF0000'), text: paragraph('Master', sized(10)) }) },
        });
        expect(shapeFills().map(fill => fill.color)).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)', 'rgb(0, 0, 255)']);
        expect(lines.map(line => line.text)).toEqual(['Slide', 'Layout', 'Master']);
    });

    it.each([
        ['slide', ['rgb(0, 0, 255)']],
        ['layout', ['rgb(0, 255, 0)', 'rgb(0, 0, 255)']],
    ])('leaves out the master\'s shapes when the %s hides them', async (hider, fills) => {
        const parts = {
            slide: { shapes: shape({ box: [0, 0, 100, 40], fill: solid('0000FF') }) },
            layout: { shapes: shape({ box: [0, 100, 100, 40], fill: solid('00FF00') }) },
            master: { shapes: shape({ box: [0, 200, 100, 40], fill: solid('FF0000') }) },
        };
        parts[hider].attributes = 'showMasterSp="0"';
        await draw(parts);
        expect(shapeFills().map(fill => fill.color)).toEqual(fills);
    });

    it('takes the slide\'s background from the slide, or else its layout, or else its master', async () => {
        const text = { shapes: shape({ box: [0, 0, 100, 40], text: paragraph('x') }) };
        await draw({ slide: { ...text, background: `<p:bgPr>${solid('112233')}</p:bgPr>` }, master: { background: `<p:bgPr>${solid('FF0000')}</p:bgPr>` } });
        expect(drawn.fills[0].color).toBe('rgb(17, 34, 51)');
        drawn.fills.length = 0;
        await draw({ slide: text, layout: { background: `<p:bgPr>${solid('445566')}</p:bgPr>` }, master: { background: `<p:bgPr>${solid('FF0000')}</p:bgPr>` } });
        expect(drawn.fills[0].color).toBe('rgb(68, 85, 102)');
        drawn.fills.length = 0;
        // A master usually names a theme color for its background.
        await draw({ slide: text, master: { background: '<p:bgRef idx="1001"><a:schemeClr val="bg2"/></p:bgRef>' } });
        expect(drawn.fills[0].color).toBe('rgb(238, 236, 225)');
        drawn.fills.length = 0;
        await draw({ slide: text });
        expect(drawn.fills[0].color).toBe('#fff');
    });
});

describe('readPptxPreview colors', () => {
    const swatches = fills => ({ shapes: fills.map((fill, index) => shape({ box: [index * 50, 0, 40, 40], fill })).join('') });

    it('finds a theme color through the master\'s map of names, or the slide\'s own', async () => {
        const fills = [solid('accent2'), solid('bg1'), solid('tx1'), solid('dk2'), '<a:solidFill><a:sysClr val="windowText" lastClr="0A0B0C"/></a:solidFill>',
            '<a:solidFill><a:prstClr val="white"/></a:solidFill>', solid('missing')];
        await draw({ slide: swatches(fills) });
        expect(shapeFills().map(fill => fill.color)).toEqual([
            'rgb(192, 80, 77)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(31, 73, 125)', 'rgb(10, 11, 12)', 'rgb(255, 255, 255)',
        ]);
        drawn.fills.length = 0;
        // A dark master swaps the background and text colors, and a slide can swap them back.
        const dark = 'bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2"';
        await draw({ slide: swatches(fills.slice(1, 3)), master: { colorMap: dark } });
        expect(shapeFills().map(fill => fill.color)).toEqual(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']);
        drawn.fills.length = 0;
        await draw({
            slide: { ...swatches(fills.slice(1, 3)), after: '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1"/></p:clrMapOvr>' },
            master: { colorMap: dark },
        });
        expect(shapeFills().map(fill => fill.color)).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
    });

    it('draws text in the theme\'s text color unless something says otherwise', async () => {
        const lines = await draw({ master: { colorMap: 'bg1="dk1" tx1="lt1"' } });
        expect(lines[0].color).toBe('rgb(255, 255, 255)');
    });

    it('takes the lighter and darker versions a color asks for', async () => {
        await draw({
            slide: swatches([
                solid('tx1', '<a:lumMod val="65000"/><a:lumOff val="35000"/>'),
                solid('bg1', '<a:lumMod val="85000"/>'),
                solid('accent1', '<a:tint val="40000"/>'),
                solid('accent1', '<a:shade val="50000"/>'),
                solid('accent1', '<a:alpha val="50000"/>'),
            ]),
        });
        expect(shapeFills().map(fill => fill.color)).toEqual([
            'rgb(89, 89, 89)', 'rgb(217, 217, 217)', 'rgb(185, 205, 229)', 'rgb(40, 65, 95)', 'rgb(79, 129, 189)',
        ]);
    });
});

describe('readPptxPreview groups and pictures', () => {
    it('places a group\'s shapes through the group\'s own space, however deep', async () => {
        await draw({
            slide: {
                shapes: group([100, 100, 200, 100], [0, 0, 400, 400],
                                shape({ box: [40, 80, 100, 100], fill: solid('FF0000') }) +
                    group([200, 200, 200, 200], [1000, 1000, 100, 100], shape({ box: [1050, 1050, 50, 50], fill: solid('00FF00') }))) +
                    shape({ box: [0, 0, 10, 10], fill: solid('0000FF') }),
            },
        });
        expect(shapeFills()).toEqual([
            { x: 120, y: 120, width: 50, height: 25, color: 'rgb(255, 0, 0)' },
            { x: 250, y: 175, width: 50, height: 25, color: 'rgb(0, 255, 0)' },
            { x: 0, y: 0, width: 10, height: 10, color: 'rgb(0, 0, 255)' },
        ]);
    });

    it('draws pictures in their boxes, a picture a shape is filled with, and a picture behind the slide', async () => {
        await draw({
            slide: {
                background: '<p:bgPr><a:blipFill><a:blip r:embed="rId4"/></a:blipFill></p:bgPr>',
                shapes: pictureShape('rId2', [10, 20, 200, 100]) +
                    shape({ box: [300, 20, 100, 100], fill: '<a:blipFill><a:blip r:embed="rId3"/></a:blipFill>' }) +
                    pictureShape('rId2', [10, 300, 50, 50]) + pictureShape('rId9', [0, 0, 5, 5]),
            },
            media: { 'photo.png': pngHeader(400, 200), 'texture.jpeg': pngHeader(64, 64), 'backdrop.png': pngHeader(2000, 1500) },
        });
        // The backdrop first, across the slide, then each shape's picture. A picture used twice is decoded once.
        expect(drawn.images.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
            [0, 0, 720, 540], [10, 20, 200, 100], [300, 20, 100, 100], [10, 300, 50, 50],
        ]);
        expect(bitmaps).toHaveLength(3);
        expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true);
    });

    it('draws a master\'s picture on every slide', async () => {
        await draw({ master: { shapes: pictureShape('rId3', [600, 10, 100, 40]) }, media: { 'logo.png': pngHeader(300, 120) } });
        expect(drawn.images.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([[600, 10, 100, 40]]);
    });

    it(`decodes at most ${SLIDE_MAX_PICTURES} pictures, and none over the pixel limit`, async () => {
        const count = SLIDE_MAX_PICTURES + 3;
        const side = Math.sqrt(OFFICE_PICTURE_MAX_PIXELS);
        await draw({
            slide: {
                shapes: shape({ box: [0, 400, 100, 40], text: paragraph('x') }) + pictureShape('rId2', [0, 0, 10, 10]) +
                    Array.from({ length: count }, (_, index) => pictureShape(`rId${index + 3}`, [index * 20, 100, 10, 10])).join(''),
            },
            media: { 'huge.png': pngHeader(side + 1, side), ...Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}.png`, pngHeader(10 + index, 10)])) },
        });
        expect(bitmaps).toHaveLength(SLIDE_MAX_PICTURES - 1);
        expect(drawn.images).toHaveLength(SLIDE_MAX_PICTURES - 1);
    });
});

describe('readPptxPreview budgets and files it cannot show', () => {
    it(`reads at most ${SLIDE_MAX_SHAPES} shapes of a part`, async () => {
        await draw({ slide: { shapes: shape({ box: [0, 0, 5, 5], fill: solid('FF0000') }).repeat(SLIDE_MAX_SHAPES + 50) } });
        expect(shapeFills()).toHaveLength(SLIDE_MAX_SHAPES);
    });

    it('lays out text up to the character budget', async () => {
        await draw({
            slide: {
                shapes: shape({ box: [0, 0, 720, 540], text: paragraph('x'.repeat(900_000), sized(1)) }) +
                    shape({ box: [0, 0, 100, 40], text: paragraph('y') }),
            },
        });
        expect(drawn.text.reduce((total, word) => total + word.text.length, 0)).toBe(SLIDE_TEXT_MAX_CHARACTERS);
        // Text is measured to find its height and again to draw it, a character at a time for a word that long.
        expect(drawn.measured).toBeLessThanOrEqual(4 * SLIDE_TEXT_MAX_CHARACTERS);
    });

    it('skips the copy of some content kept for older readers', async () => {
        const lines = await draw({
            slide: {
                shapes: `<mc:AlternateContent><mc:Choice Requires="p14">${shape({ box: [0, 0, 200, 40], text: paragraph('Shown') })}</mc:Choice>` +
                    `<mc:Fallback>${shape({ box: [0, 100, 200, 40], text: paragraph('Fallback') })}</mc:Fallback></mc:AlternateContent>`,
            },
        });
        expect(lines.map(line => line.text)).toEqual(['Shown']);
    });

    it.each([
        ['unclosed tags', `<${'a'.repeat(900_000)}`],
        ['a long run of shapes that never close', '<p:sp><p:spPr>'.repeat(60_000)],
        ['a long run of colors that never close', `<p:sp><p:spPr>${'<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="1"/>'.repeat(15_000)}`],
    ])('reads %s without slowing down', async (_label, markup) => {
        const started = performance.now();
        const lines = await draw({ slide: { shapes: shape({ box: [0, 0, 200, 40], text: paragraph('Shown') }) + markup } });
        expect(lines[0].text).toBe('Shown');
        expect(performance.now() - started).toBeLessThan(2000);
    });

    it.each([
        ['a slide with nothing on it', { slide: { shapes: '' } }],
        ['a slide with only empty placeholders', { slide: { shapes: shape({ placeholder: 'type="title"', text: '<a:p><a:endParaRPr/></a:p>' }) }, layout: { shapes: shape({ placeholder: 'type="title"', box: [0, 0, 100, 40], text: paragraph('Click to add title') }) } }],
        ['a slide whose only shape has no position', { slide: { shapes: shape({ text: paragraph('Nowhere') }) } }],
        ['a slide with only a plain background', { slide: { shapes: '', background: `<p:bgPr>${solid('FF0000')}</p:bgPr>` } }],
    ])('returns nothing for %s', async (_label, options) => {
        expect(await readPptxPreview(pptxFile(options))).toBeUndefined();
    });

    it.each([
        ['an empty file', new Uint8Array(0)],
        ['a file that is not a ZIP archive', new TextEncoder().encode('not a presentation, only named like one')],
        ['an archive without a presentation', createZip({ 'word/document.xml': '<w:document/>' })],
        ['a presentation that lists no slides', createZip({ 'ppt/presentation.xml': '<p:presentation><p:sldIdLst/></p:presentation>' })],
        ['an archive with an encrypted presentation', createPptx({ flags: 1 })],
    ])('returns nothing for %s', async (_label, bytes) => {
        expect(await readPptxPreview(new File([bytes], 'deck.pptx'))).toBeUndefined();
    });

    it('draws a slide whose layout, master and theme are missing', async () => {
        const preview = await readPptxPreview(new File([createZip({
            'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
            'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId1" Type="x/slide" Target="slides/only.xml"/></Relationships>',
            'ppt/slides/only.xml': `<p:sld><p:cSld><p:spTree>${shape({ box: [10, 10, 200, 40], fill: solid('accent1'), text: paragraph('Alone') })}</p:spTree></p:cSld></p:sld>`,
        })], 'deck.pptx'));
        expect(preview).toBeInstanceOf(File);
        // A color the missing theme would have named is left out; the text falls back to black at the default size.
        expect(shapeFills()).toEqual([]);
        expect(linesOf(drawn).map(({ text, font, color }) => [text, font, color])).toEqual([['Alone', '18px sans-serif', '#000']]);
    });

    it('returns nothing for a presentation cut off anywhere', async () => {
        const pptx = createPptx();
        for ( let length = 0; length < pptx.length; length += 7 ) {
            expect(await readPptxPreview(new File([pptx.subarray(0, length)], 'deck.pptx'))).toBeUndefined();
        }
    });

    it('stops when the upload is cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await readPptxPreview(pptxFile(), controller.signal)).toBeUndefined();
    });
});
