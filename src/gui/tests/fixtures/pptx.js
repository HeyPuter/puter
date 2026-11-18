// Presentations (PPTX) assembled part by part into a ZIP archive, generated without a presentation library.
import { createZip } from './docx.js';
import { THEME_COLORS } from './xlsx.js';

const NAMESPACES = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const EMUS_PER_POINT = 12700;
const emu = points => Math.round(points * EMUS_PER_POINT);

/** A position and size, from `[x, y, width, height]` in points. */
export const frame = ([x, y, width, height]) =>
    `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>`;

/** A paragraph of one run. `properties` are the paragraph's (`<a:pPr>`) and `runProperties` the run's (`<a:rPr>`). */
export const paragraph = (text, { properties = '', runProperties = '' } = {}) =>
    `<a:p>${properties}<a:r>${runProperties}<a:t>${text}</a:t></a:r></a:p>`;

/**
 * A shape. `box` is `[x, y, width, height]` in points, and a placeholder can leave it out. `placeholder` is the
 * attributes of its `<p:ph>`, `fill` and `geometry` go in its shape properties, `body` in its text's `<a:bodyPr>`,
 * `levels` in its `<a:lstStyle>`, `style` is a whole `<p:style>`, and `text` is paragraphs.
 */
export const shape = ({ box, placeholder, fill = '', geometry = 'rect', body = '', levels = '', style = '', text } = {}) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Shape"/><p:cNvSpPr/><p:nvPr>${placeholder === undefined ? '' : `<p:ph ${placeholder}/>`}</p:nvPr></p:nvSpPr>` +
    `<p:spPr>${box ? frame(box) : ''}${geometry ? `<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>` : ''}${fill}</p:spPr>${style}${
        text === undefined ? '' : `<p:txBody><a:bodyPr ${body}/><a:lstStyle>${levels}</a:lstStyle>${text}</p:txBody>`}</p:sp>`;

/** A picture shown from the media file with relationship `id`, in a box of `[x, y, width, height]` points. */
export const pictureShape = (id, box) => '<p:pic><p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>' +
    `<p:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${frame(box)}</p:spPr></p:pic>`;

/** A group that places `children`, laid out in a space of `childBox`, into `box`. Both are in points. */
export const group = (box, childBox, children) => '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="4" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    `<p:grpSpPr><a:xfrm><a:off x="${emu(box[0])}" y="${emu(box[1])}"/><a:ext cx="${emu(box[2])}" cy="${emu(box[3])}"/>` +
    `<a:chOff x="${emu(childBox[0])}" y="${emu(childBox[1])}"/><a:chExt cx="${emu(childBox[2])}" cy="${emu(childBox[3])}"/></a:xfrm></p:grpSpPr>${children}</p:grpSp>`;

/** A solid fill of six hex digits, or of a theme color such as `accent1` with optional changes to it. */
export const solid = (color, changes = '') => `<a:solidFill>${/^[0-9a-f]{6}$/i.test(color)
    ? `<a:srgbClr val="${color}"/>`
    : `<a:schemeClr val="${color}">${changes}</a:schemeClr>`}</a:solidFill>`;

const part = (root, { shapes = '', background = '', attributes = '', after = '' }) =>
    `${XML}<p:${root} ${NAMESPACES} ${attributes}><p:cSld>${background && `<p:bg>${background}</p:bg>`}<p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    `${shapes}</p:spTree></p:cSld>${after}</p:${root}>`;
const relationships = entries => `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    entries.map(([kind, target], index) => `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIPS}/${kind}" Target="${target}"/>`).join('')}</Relationships>`;

/**
 * A PPTX of one slide on one layout and one master. `slide`, `layout` and `master` each take `shapes`, a
 * `background` (the content of `<p:bg>`), root `attributes` and markup to put `after` the shapes; the master's
 * `textStyles` is the content of its `<p:txStyles>` and its `colorMap` the attributes of its `<p:clrMap>`. `theme`
 * lists colors in the theme's own order, `size` is the slide's in points, `media` maps file names under `ppt/media/`
 * to their bytes, related to the slide as `rId2`, `rId3`, ... in order, and `thumbnail` is a stored first-slide JPEG.
 * `slides` adds more slides after the first, and `firstSlide` names the part the presentation lists first.
 */
export const createPptx = ({
    slide = { shapes: shape({ box: [36, 36, 300, 60], text: paragraph('Hello') }) },
    layout = {},
    master = {},
    theme = ['000000', 'FFFFFF', '1F497D', 'EEECE1', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646', '0000FF', '800080'],
    size = [720, 540],
    media = {},
    thumbnail,
    slides = [],
    firstSlide = 'slide1',
    ...zipOptions
} = {}) => {
    const type = kind => `application/vnd.openxmlformats-officedocument.${kind}+xml`;
    const slideNames = ['slide1', ...slides.map((_, index) => `slide${index + 2}`)]
        .sort((a, b) => (a === firstSlide ? -1 : b === firstSlide ? 1 : 0));
    const colorMap = master.colorMap ?? 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" ' +
        'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
    return createZip({
        '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
            '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
            `<Override PartName="/ppt/presentation.xml" ContentType="${type('presentationml.presentation.main')}"/>` +
            `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${type('presentationml.slideMaster')}"/>` +
            `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${type('presentationml.slideLayout')}"/>` +
            `<Override PartName="/ppt/theme/theme1.xml" ContentType="${type('theme')}"/>${slideNames.map(name =>
                `<Override PartName="/ppt/slides/${name}.xml" ContentType="${type('presentationml.slide')}"/>`).join('')}</Types>`,
        '_rels/.rels': relationships([['officeDocument', 'ppt/presentation.xml']]),
        ...(thumbnail && { 'docProps/thumbnail.jpeg': thumbnail }),
        'ppt/presentation.xml': `${XML}<p:presentation ${NAMESPACES}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
            `<p:sldIdLst>${slideNames.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst>${
                size ? `<p:sldSz cx="${emu(size[0])}" cy="${emu(size[1])}"/>` : ''}<p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
        'ppt/_rels/presentation.xml.rels': relationships([
            ['slideMaster', 'slideMasters/slideMaster1.xml'],
            ...slideNames.map(name => ['slide', `slides/${name}.xml`]),
        ]),
        'ppt/slides/slide1.xml': part('sld', slide),
        'ppt/slides/_rels/slide1.xml.rels': relationships([
            ['slideLayout', '../slideLayouts/slideLayout1.xml'],
            ...Object.keys(media).map(name => ['image', `../media/${name}`]),
        ]),
        ...Object.fromEntries(slides.flatMap((extra, index) => [
            [`ppt/slides/slide${index + 2}.xml`, part('sld', extra)],
            [`ppt/slides/_rels/slide${index + 2}.xml.rels`, relationships([['slideLayout', '../slideLayouts/slideLayout1.xml']])],
        ])),
        'ppt/slideLayouts/slideLayout1.xml': part('sldLayout', layout),
        'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationships([
            ['slideMaster', '../slideMasters/slideMaster1.xml'],
            ...Object.keys(media).map(name => ['image', `../media/${name}`]),
        ]),
        'ppt/slideMasters/slideMaster1.xml': part('sldMaster', {
            ...master,
            after: `<p:clrMap ${colorMap}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
                `<p:txStyles>${master.textStyles ?? ''}</p:txStyles>`,
        }),
        'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationships([
            ['slideLayout', '../slideLayouts/slideLayout1.xml'],
            ['theme', '../theme/theme1.xml'],
            ...Object.keys(media).map(name => ['image', `../media/${name}`]),
        ]),
        'ppt/theme/theme1.xml': `${XML}<a:theme ${NAMESPACES} name="Test"><a:themeElements><a:clrScheme name="Test">${
            theme.map((color, index) => `<a:${THEME_COLORS[index]}><a:srgbClr val="${color}"/></a:${THEME_COLORS[index]}>`).join('')
        }</a:clrScheme></a:themeElements></a:theme>`,
        ...Object.fromEntries(Object.entries(media).map(([name, bytes]) => [`ppt/media/${name}`, bytes])),
    }, zipOptions);
};
