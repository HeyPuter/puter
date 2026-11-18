import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Reading a weblink's icon needs the page; no test here has a weblink.
vi.mock('./weblink.js', () => ({ getWeblinkIcon: async () => 'weblink' }));
const { default: item_icon } = await import('./itemIcon.js');

const thumbnail = 'https://thumbnails.example/abc';
const entry = (name, extra = {}) => ({ name, path: `/user/${name}`, is_dir: false, thumbnail, ...extra });

beforeEach(() => {
    // Each icon's value is its own file name, so a test can tell which one was picked.
    vi.stubGlobal('window', {
        trash_path: '/user/Trash',
        appdata_path: '/user/AppData',
        icons: new Proxy({}, { get: (_icons, name) => name }),
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('item_icon for a file with a thumbnail', () => {
    it.each(['photo.jpg', 'clip.mp4', 'art.psd', 'report.pdf', 'letter.docx', 'budget.xlsx'])(
        'shows the thumbnail of %s where there is room for it', async (name) => {
            expect(await item_icon(entry(name))).toEqual({ image: thumbnail, type: 'thumb' });
        },
    );

    it.each(['photo.jpg', 'clip.mp4', 'art.psd', 'logo.ai'])('shows the thumbnail of %s in a list row too', async (name) => {
        expect(await item_icon(entry(name), { listRow: true })).toEqual({ image: thumbnail, type: 'thumb' });
    });

    it.each([
        ['report.pdf', 'file-pdf.svg'],
        ['REPORT.PDF', 'file-pdf.svg'],
        ['letter.doc', 'file-doc.svg'],
        ['letter.docx', 'file-docx.svg'],
        ['budget.xlsx', 'file-xlsx.svg'],
        ['deck.pptx', 'file-pptx.svg'],
    ])('shows the type icon of %s in a list row, where a page is too small to make out', async (name, icon) => {
        expect(await item_icon(entry(name, { type: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined }), { listRow: true }))
            .toEqual({ image: icon, type: 'icon' });
    });

    it('keeps the thumbnail of a folder named like a document in a list row', async () => {
        expect(await item_icon(entry('scans.pdf', { is_dir: true }), { listRow: true })).toEqual({ image: thumbnail, type: 'thumb' });
    });

    it('shows a document with no thumbnail by its type icon either way', async () => {
        const file = entry('letter.docx', { thumbnail: undefined });
        expect(await item_icon(file)).toEqual({ image: 'file-docx.svg', type: 'icon' });
        expect(await item_icon(file, { listRow: true })).toEqual({ image: 'file-docx.svg', type: 'icon' });
    });
});
