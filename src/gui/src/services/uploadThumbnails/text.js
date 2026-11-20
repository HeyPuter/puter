import { TEXT_MAX_READ_BYTES } from './config.js';

/**
 * A page for text that has no page of its own, such as source code. It has the shape of US Letter at a fraction of
 * the size, so that the text on it can be made out in a thumbnail.
 *
 * @returns {import('./page.js').Page}
 */
export const createTextPage = () => ({
    width: 255,
    height: 330,
    margins: { top: 18, right: 18, bottom: 18, left: 18 },
    blocks: [],
});

/**
 * Read the start of a text file, as far as the read budget goes.
 *
 * @param {Blob} file
 * @returns {Promise<string | undefined>} The text, with each line ending in `\n`, or `undefined` for a file that is
 *     blank or isn't text.
 */
export const readLeadingText = async (file) => {
    const bytes = await file.slice(0, TEXT_MAX_READ_BYTES).arrayBuffer();
    let text;
    try {
        // Streaming leaves out a character the read cut in two, rather than failing on it.
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    } catch {
        // Text that isn't UTF-8 is most often in the Windows code page, which Excel saves a CSV in by default.
        text = new TextDecoder('windows-1252').decode(bytes);
    }
    // Text holds no NUL. A file that does is something else under a text file's name, or text in UTF-16.
    if ( text.includes('\0') || !text.trim() ) return undefined;
    return text.replace(/\r\n?/g, '\n');
};
