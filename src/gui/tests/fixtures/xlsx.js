// Spreadsheets (XLSX) assembled part by part into a ZIP archive, generated without a spreadsheet library.
import { createZip } from './docx.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
// The colors of a theme, in the order a theme lists them.
export const THEME_COLORS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

/**
 * A cell. `type` is the cell's `t` attribute: `s` for a position in the shared strings, `inlineStr` for text kept
 * in the cell, `str`, `b` or `e`, and a number when left out. `style` is its position in the cell formats.
 */
export const cell = (reference, value = '', { type, style } = {}) =>
    `<c${reference ? ` r="${reference}"` : ''}${style === undefined ? '' : ` s="${style}"`}${type ? ` t="${type}"` : ''}>${
        type === 'inlineStr' ? `<is><t>${value}</t></is>` : value === '' ? '' : `<v>${value}</v>`}</c>`;

/** A row of cells, with optional attributes such as ` ht="30"`. */
export const row = (number, cells, attributes = '') => `<row${number ? ` r="${number}"` : ''}${attributes}>${cells}</row>`;

/** A styles part with these fonts, fills and cell formats, each given as the XML inside its list. */
export const styles = ({
    fonts = '<font/>',
    fills = '<fill><patternFill patternType="none"/></fill>',
    formats = '<xf/>',
    before = '',
} = {}) =>
    `${before}<fonts>${fonts}</fonts><fills>${fills}</fills><cellXfs>${formats}</cellXfs>`;

/**
 * An XLSX. `sheet` is the content of its one worksheet; `sheets` replaces it with a list of
 * `{ content, state, chart }` in tab order, where `chart` makes a chart sheet. `strings` are the shared strings,
 * `styles` the content of the styles part, `theme` the theme's colors as hex digits in the theme's own order and
 * `thumbnail` a stored first-page JPEG.
 */
export const createXlsx = ({
    sheet = `<sheetData>${row(1, cell('A1', 'Hello', { type: 'str' }))}</sheetData>`,
    sheets = [{ content: sheet }],
    strings,
    styles: styleSheet,
    theme,
    thumbnail,
    ...zipOptions
} = {}) => {
    const partOf = ({ chart }, index) => `${chart ? 'chartsheets' : 'worksheets'}/sheet${index + 1}.xml`;
    const type = kind => `application/vnd.openxmlformats-officedocument.${kind}+xml`;
    const override = (part, kind) => `<Override PartName="/xl/${part}" ContentType="${type(kind)}"/>`;
    return createZip({
        '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            `<Default Extension="xml" ContentType="application/xml"/>${override('workbook.xml', 'spreadsheetml.sheet.main')}${
                sheets.map((entry, index) => override(partOf(entry, index), `spreadsheetml.${entry.chart ? 'chartsheet' : 'worksheet'}`)).join('')}${
                strings ? override('sharedStrings.xml', 'spreadsheetml.sharedStrings') : ''}${
                styleSheet === undefined ? '' : override('styles.xml', 'spreadsheetml.styles')}${
                theme ? override('theme/theme1.xml', 'theme') : ''}</Types>`,
        '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        ...(thumbnail && { 'docProps/thumbnail.jpeg': thumbnail }),
        'xl/workbook.xml': `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets>${sheets.map(({ state }, index) =>
            `<sheet name="Sheet${index + 1}" sheetId="${index + 1}"${state ? ` state="${state}"` : ''} r:id="rId${index + 1}"/>`).join('')
        }</sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
            sheets.map((entry, index) => `<Relationship Id="rId${index + 1}" Type="${RELATIONSHIPS}/${
                entry.chart ? 'chartsheet' : 'worksheet'}" Target="${partOf(entry, index)}"/>`).join('')}</Relationships>`,
        ...Object.fromEntries(sheets.map((entry, index) => [
            `xl/${partOf(entry, index)}`,
            `${XML}<${entry.chart ? 'chartsheet' : 'worksheet'} xmlns="${MAIN}">${entry.content}</${entry.chart ? 'chartsheet' : 'worksheet'}>`,
        ])),
        ...(strings && {
            'xl/sharedStrings.xml': `${XML}<sst xmlns="${MAIN}">${strings.map(string =>
                (string.startsWith('<') ? string : `<si><t>${string}</t></si>`)).join('')}</sst>`,
        }),
        ...(styleSheet !== undefined && { 'xl/styles.xml': `${XML}<styleSheet xmlns="${MAIN}">${styleSheet}</styleSheet>` }),
        ...(theme && {
            'xl/theme/theme1.xml': `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements>` +
                `<a:clrScheme name="Test">${theme.map((color, index) => `<a:${THEME_COLORS[index]}>${index < 2
                    ? `<a:sysClr val="windowText" lastClr="${color}"/>`
                    : `<a:srgbClr val="${color}"/>`}</a:${THEME_COLORS[index]}>`).join('')}</a:clrScheme></a:themeElements></a:theme>`,
        }),
    }, zipOptions);
};
