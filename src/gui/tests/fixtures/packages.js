// Packaged documents that carry a picture of themselves: an EPUB is built here, and the others are plain archives a
// test can make with `createZip()`.
import { createZip } from './docx.js';

const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';

/**
 * An EPUB whose cover is `cover`, kept at `coverHref` relative to the package document at `packageName`. The cover
 * is declared the EPUB 3 way (`property`), the EPUB 2 way (`meta`) or not at all (`none`); `coverId` is its id in
 * the list of files, and `prefix` puts the package document's elements under a namespace prefix.
 */
export const createEpub = ({
    cover,
    coverHref = 'images/cover.jpg',
    coverId = 'cover-art',
    packageName = 'OEBPS/content.opf',
    declare = 'property',
    prefix = '',
    extra = {},
    ...zipOptions
} = {}) => {
    const folder = packageName.slice(0, Math.max(0, packageName.lastIndexOf('/')));
    const tag = name => `${prefix}${name}`;
    // The cover's entry name: its href with percent-encoding undone and `..` steps taken.
    const segments = [];
    for ( const segment of `${folder}/${coverHref}`.split('/').map(decodeURIComponent) ) {
        if ( segment === '..' ) segments.pop();
        else if ( segment ) segments.push(segment);
    }
    return createZip({
        mimetype: 'application/epub+zip',
        'META-INF/container.xml': `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>` +
            `<rootfile full-path="${packageName}" media-type="application/oebps-package+xml"/></rootfiles></container>`,
        [packageName]: `${XML}<${tag('package')} xmlns${prefix && `:${prefix.slice(0, -1)}`}="http://www.idpf.org/2007/opf" version="${declare === 'meta' ? '2.0' : '3.0'}">` +
            `<${tag('metadata')}>${declare === 'meta' ? `<${tag('meta')} name="cover" content="${coverId}"/>` : ''}<${tag('meta')} name="generator" content="test"/></${tag('metadata')}>` +
            `<${tag('manifest')}><${tag('item')} id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>` +
            `<${tag('item')} id="logo" href="images/logo.png" media-type="image/png"/>` +
            `<${tag('item')} id="${coverId}" href="${coverHref}" media-type="image/jpeg"${declare === 'property' ? ' properties="cover-image"' : ''}/>` +
            `</${tag('manifest')}></${tag('package')}>`,
        [`${folder}/chapter.xhtml`]: '<html><body><p>Chapter</p></body></html>',
        ...(cover && { [segments.join('/')]: cover }),
        ...extra,
    }, { stored: ['mimetype'], ...zipOptions });
};
