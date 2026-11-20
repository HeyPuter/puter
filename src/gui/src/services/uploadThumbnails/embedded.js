import { EMBEDDED_PREVIEW_MAX_BYTES, EMBEDDED_PREVIEW_MAX_PIXELS, OFFICE_XML_MAX_BYTES } from './config.js';
import { imageTypeOf, pixelSizeOf } from './images.js';
import { TOKEN, attributesOf, decodeEntities } from './ooxml.js';
import { openArchive } from './zip.js';

// Where the editors of these formats keep a picture of the document, the one to use first. Each is the editor's own
// rendering of the first page, sheet, slide or artboard.
const PREVIEW_ENTRIES = [
    // Pages, Numbers and Keynote: the full preview, then the small one made for the web. Versions before 2013 kept
    // one in a folder for Quick Look.
    'preview.jpg',
    'preview-web.jpg',
    'QuickLook/Thumbnail.jpg',
    // OpenDocument text, spreadsheets and presentations.
    'Thumbnails/thumbnail.png',
    'Thumbnails/thumbnail.jpg',
    // Sketch.
    'previews/preview.png',
];

// An entry's name, from a path as an EPUB writes it: relative to a folder, percent-encoded, with `..` steps in it.
const entryNameOf = (folder, path) => {
    const segments = [];
    for ( const encoded of `${folder}/${path}`.split('/') ) {
        let segment = encoded;
        try {
            segment = decodeURIComponent(encoded);
        } catch {
            // A stray percent sign is part of the name.
        }
        if ( segment === '..' ) segments.pop();
        else if ( segment && segment !== '.' ) segments.push(segment);
    }
    return segments.join('/');
};

/**
 * Find the cover image of an EPUB. Its container names the package document, which lists the book's files and says
 * which one is the cover: by a property on the file in EPUB 3, by a `cover` entry in the metadata in EPUB 2.
 *
 * @param {(name: string) => Promise<string | undefined>} textOf Reads a part of the archive as text.
 * @returns {Promise<string[]>} The entry names that may be the cover, the likeliest first.
 */
const findEpubCovers = async (textOf) => {
    let packageName;
    for ( const [, closing, tag, source] of (await textOf('META-INF/container.xml'))?.matchAll(TOKEN) ?? [] ) {
        const path = !closing && tag?.endsWith('rootfile') && attributesOf(source)['full-path'];
        if ( path ) packageName ??= decodeEntities(path);
    }
    const document = packageName && await textOf(packageName);
    if ( ! document ) return [];
    const images = [];
    let named;
    for ( const [, closing, tag, source] of document.matchAll(TOKEN) ) {
        // Elements can carry a namespace prefix.
        const name = tag?.slice(tag.indexOf(':') + 1);
        if ( closing || (name !== 'item' && name !== 'meta') ) continue;
        const attributes = attributesOf(source);
        if ( name === 'meta' && attributes.name === 'cover' ) named ??= attributes.content;
        else if ( name === 'item' && attributes['media-type']?.startsWith('image/') && attributes.href ) images.push(attributes);
    }
    // A book can declare its cover both ways, and one of them can be a picture that isn't usable here, such as an SVG.
    // A book that says neither usually still calls its cover one.
    const folder = packageName.slice(0, Math.max(0, packageName.lastIndexOf('/')));
    return [...new Set([
        images.find(image => image.properties?.split(/\s+/).includes('cover-image')),
        images.find(image => named !== undefined && image.id === named),
        images.find(image => /cover/i.test(`${image.id} ${image.href}`)),
    ].filter(Boolean).map(image => entryNameOf(folder, decodeEntities(image.href))))];
};

/**
 * Get the picture of itself that a packaged document carries: the preview Pages, Numbers and Keynote save in their
 * files, the thumbnail an OpenDocument file holds, a Sketch file's preview, or an EPUB's cover. Nothing is rendered.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} An image file browsers can decode, or `undefined` when the file holds none.
 */
export const readEmbeddedPreview = async (file, signal) => {
    const archive = await openArchive(file);
    if ( !archive || signal?.aborted ) return undefined;
    const { entries, contentOf } = archive;
    const imageOf = async (name) => {
        const entry = entries.get(name);
        if ( !entry || entry.size > EMBEDDED_PREVIEW_MAX_BYTES ) return undefined;
        // A damaged entry is passed over like a missing one, so the next picture the file holds is still tried.
        const content = await contentOf(entry, EMBEDDED_PREVIEW_MAX_BYTES).catch(() => undefined);
        if ( ! content ) return undefined;
        // What kind of image it is, and how large, comes from its own bytes.
        const view = new DataView(await content.arrayBuffer());
        const type = imageTypeOf(view);
        const pixels = pixelSizeOf(view);
        // A small file can state a very large picture, and decoding one takes memory by the pixel.
        if ( !type || !pixels?.width || !pixels.height || pixels.width * pixels.height > EMBEDDED_PREVIEW_MAX_PIXELS ) {
            return undefined;
        }
        return new File([content], 'preview', { type });
    };

    // The container is what makes an archive an EPUB, whatever the file is called.
    const names = entries.has('META-INF/container.xml')
        ? await findEpubCovers(async name => (await contentOf(entries.get(name), OFFICE_XML_MAX_BYTES))?.text())
        : PREVIEW_ENTRIES;
    for ( const name of names ) {
        if ( signal?.aborted ) return undefined;
        const image = await imageOf(name);
        if ( image ) return image;
    }
    return undefined;
};
