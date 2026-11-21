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
 *     blank or isn't text. Text is read as UTF-8, or as UTF-16 after a byte order mark.
 */
export const readLeadingText = async (file) => {
    const bytes = new Uint8Array(await file.slice(0, TEXT_MAX_READ_BYTES).arrayBuffer());
    // Notepad and Excel save Unicode text as UTF-16, which starts with a byte order mark. The decoder drops the mark.
    const encoding = bytes[0] === 0xFF && bytes[1] === 0xFE ? 'utf-16le'
        : bytes[0] === 0xFE && bytes[1] === 0xFF ? 'utf-16be' : 'utf-8';
    let text;
    try {
        // Streaming leaves out a character the read cut in two, rather than failing on it.
        text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: true });
    } catch {
        // Text that isn't UTF-8 is most often in the Windows code page, which Excel saves a CSV in by default.
        text = new TextDecoder('windows-1252').decode(bytes);
    }
    // Text holds no NUL. A file that does is something else under a text file's name, or UTF-16 with no mark.
    if ( text.includes('\0') || !text.trim() ) return undefined;
    return text.replace(/\r\n?/g, '\n');
};
