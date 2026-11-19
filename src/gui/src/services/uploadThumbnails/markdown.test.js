import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas, linesOf } from '../../../tests/fixtures/canvas.js';
import { parseMarkdown, readMarkdownPreview } from './markdown.js';

/** The text of each paragraph block, with its runs joined. */
const textOf = blocks => blocks.map(block => block.runs.map(run => run.text).join(''));
/** The text of each run of the first block, with what sets the run apart from plain body text. */
const runsOf = (markdown) => {
    const [plain] = parseMarkdown('x')[0].runs;
    return parseMarkdown(markdown)[0].runs.map((run) => {
        const marks = [
            run.bold && 'bold',
            run.italic && 'italic',
            run.family,
            run.color !== plain.color && 'colored',
        ].filter(Boolean);
        return marks.length ? [run.text, ...marks] : run.text;
    });
};

let drawn;
const draw = async (markdown) => {
    const preview = await readMarkdownPreview(new File([markdown], 'README.md'));
    expect(preview).toBeInstanceOf(File);
    expect(preview.type).toBe('image/png');
    return linesOf(drawn);
};

beforeEach(() => {
    const canvas = createRecordingCanvas();
    drawn = canvas.drawn;
    vi.stubGlobal('OffscreenCanvas', canvas.Canvas);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('parseMarkdown', () => {
    it('joins the lines of a paragraph and splits paragraphs at blank lines', () => {
        expect(textOf(parseMarkdown('One\ntwo.\n\nThree.\n'))).toEqual(['One two.', 'Three.']);
    });

    it('sizes headings by level, in bold', () => {
        const blocks = parseMarkdown('# One\n## Two ##\n###### Six\nBody');
        expect(textOf(blocks)).toEqual(['One', 'Two', 'Six', 'Body']);
        const sizes = blocks.map(block => block.runs[0].size);
        expect(sizes[0]).toBeGreaterThan(sizes[1]);
        expect(sizes[1]).toBeGreaterThan(sizes[2]);
        expect(sizes[2]).toBe(sizes[3]);
        expect(blocks.map(block => block.runs[0].bold)).toEqual([true, true, true, false]);
        // An empty line on the page is as tall as the heading's text.
        expect(blocks[0].size).toBe(sizes[0]);
    });

    it('reads a paragraph underlined with = or - as a heading', () => {
        const blocks = parseMarkdown('Title\n=====\n\nSection\nname\n---\n\nBody');
        expect(textOf(blocks)).toEqual(['Title', 'Section name', 'Body']);
        expect(blocks.map(block => block.runs[0].bold)).toEqual([true, true, false]);
        expect(blocks[0].runs[0].size).toBeGreaterThan(blocks[1].runs[0].size);
    });

    it('reads an HTML heading as a heading, without its tags', () => {
        const blocks = parseMarkdown('<h1 align="center">\n  <img src="logo.png"><br>\n  Project\n</h1>\n\n<p align="center">About it</p>');
        expect(textOf(blocks)).toEqual(['Project ', 'About it']);
        expect(blocks[0].runs[0]).toMatchObject({ bold: true, size: parseMarkdown('# x')[0].runs[0].size });
        expect(blocks[1].runs[0].bold).toBe(false);
        expect(blocks.map(block => block.align)).toEqual(['center', 'center']);
    });

    it('starts and ends a block at an HTML block tag, however the lines around it run', () => {
        const blocks = parseMarkdown([
            '<p align="center">',
            '  <img src="logo.png">',
            '</p>',
            '<h1 align="center">My Project</h1>',
            '<p align="right">A tiny tool</p>',
            'Body',
        ].join('\n'));
        expect(textOf(blocks)).toEqual(['My Project', 'A tiny tool', 'Body']);
        expect(blocks[0].runs[0].bold).toBe(true);
        expect(blocks.map(block => block.align)).toEqual(['center', 'end', 'start']);
    });

    it('aligns what is inside a centered <div> or <center>, up to its end tag', () => {
        const blocks = parseMarkdown([
            '<div align="center">',
            '',
            '# Title',
            '',
            'Tagline',
            '',
            '```',
            'code',
            '```',
            '</div>',
            '<center>Old</center>',
            '',
            'After',
        ].join('\n'));
        expect(textOf(blocks)).toEqual(['Title', 'Tagline', 'code', 'Old', 'After']);
        expect(blocks.map(block => block.align)).toEqual(['center', 'center', 'start', 'center', 'start']);
    });

    it('breaks the line at a <br>, without the space around it', () => {
        expect(textOf(parseMarkdown('A tiny tool<br>that works\n\n**Demo**  <br/>\n  <br />\n  <a href="x">[Site](x)</a> · <img src="x"> Docs<BR>'))).toEqual([
            'A tiny tool\nthat works',
            'Demo  \n\nSite ·  Docs',
        ]);
    });

    it.each([
        ['bold and italic', 'a **b** *c* __d__ _e_ ***f***', ['a ', ['b', 'bold'], ' ', ['c', 'italic'], ' ', ['d', 'bold'], ' ', ['e', 'italic'], ' ', ['f', 'bold', 'italic']]],
        ['marks inside marks', '**a *b* c**', [['a ', 'bold'], ['b', 'bold', 'italic'], [' c', 'bold']]],
        ['code', 'run `npm *test*` now', ['run ', ['npm *test*', 'monospace'], ' now']],
        ['links', 'see [the **docs**](https://x.test/a_b) and [ref][1]', ['see ', ['the ', 'colored'], ['docs', 'bold', 'colored'], ' and ', ['ref', 'colored']]],
        ['an address in angle brackets', 'at <https://x.test>', ['at ', ['https://x.test', 'colored']]],
        ['struck text, as plain text', 'a ~~b~~ c', ['a ', 'b', ' c']],
        ['escapes and entities', '\\*not\\* &amp; &lt;b&gt;', ['*', 'not', '*', ' ', '&', ' ', '<', 'b', '>']],
        ['underscores inside words', 'snake_case_name and 2 * 3 * 4', ['snake_case_name and 2 * 3 * 4']],
        ['marks that never close', '**open and `open and [open', ['**open and `open and [open']],
    ])('reads %s', (_label, markdown, expected) => {
        expect(runsOf(markdown)).toEqual(expected);
    });

    it.each([
        ['pictures', 'Before ![logo](logo.png) after ![ref][logo]', ['Before  after ']],
        ['badges, and the space they leave at the start', '[![build](https://x.test/b.svg)](https://x.test) Text', ['Text']],
        ['HTML tags', '<details><summary>More</summary>\n<img src="a.png">\n</details>', ['More  ']],
        ['comments', 'a <!-- hidden\nacross lines --> b\n<!-- never closed', ['a  b']],
        ['front matter', '---\ntitle: Hidden\n---\nShown', ['Shown']],
        ['rules', 'a\n\n---\n\n* * *\n\nb', ['a', 'b']],
        ['the addresses links refer to', 'a\n\n[1]: https://x.test\n', ['a']],
        ['paragraphs that were only pictures', '![a](a.png)\n\n<br>\n\nText', ['Text']],
    ])('leaves out %s', (_label, markdown, expected) => {
        expect(textOf(parseMarkdown(markdown))).toEqual(expected);
    });

    it('hangs a marker before each list item, further in for each level', () => {
        const blocks = parseMarkdown('- one\n  continued\n  - two\n      - three\n* four\n\n1. first\n10) tenth');
        expect(textOf(blocks)).toEqual(['one continued', 'two', 'three', 'four', 'first', 'tenth']);
        expect(blocks.map(block => block.marker.text)).toEqual(['•', '•', '•', '•', '1.', '10)']);
        const indents = blocks.map(block => block.indent);
        expect(indents[1]).toBeGreaterThan(indents[0]);
        expect(indents[2]).toBeGreaterThan(indents[1]);
        expect(indents[3]).toBe(indents[0]);
        expect(blocks.every(block => block.marker.offset < 0)).toBe(true);
        // A longer marker starts further before the text.
        expect(blocks[5].marker.offset).toBeLessThan(blocks[4].marker.offset);
    });

    it('indents a quote and draws it in another color', () => {
        const blocks = parseMarkdown('Body\n> quoted\n> **more**\n\nBody');
        expect(textOf(blocks)).toEqual(['Body', 'quoted more', 'Body']);
        expect(blocks[1].indent).toBeGreaterThan(0);
        expect(blocks[1].runs[0].color).not.toBe(blocks[0].runs[0].color);
        expect(blocks[1].runs[1]).toMatchObject({ bold: true, color: blocks[1].runs[0].color });
        expect(blocks[2]).toMatchObject({ indent: 0, runs: [{ color: blocks[0].runs[0].color }] });
    });

    it('keeps fenced code as it is written, in a fixed-width font that does not wrap', () => {
        const blocks = parseMarkdown('Run:\n```sh\nnpm *install*\n\n\tnpm test\n```\nDone\n~~~\nopen to the end');
        expect(textOf(blocks)).toEqual(['Run:', 'npm *install*\n\n    npm test', 'Done', 'open to the end']);
        expect(blocks[1]).toMatchObject({ wrap: false, runs: [{ family: 'monospace' }] });
        expect(blocks[0].wrap).toBeUndefined();
    });

    it('reads a fence indented inside a list item as the item\'s code', () => {
        const blocks = parseMarkdown('1. Install:\n\n    ```bash\n    npm install\n      --save\n    ```\n\n2. Start:\n   ~~~\n   npm start\n   ~~~');
        expect(textOf(blocks)).toEqual(['Install:', 'npm install\n  --save', 'Start:', 'npm start']);
        expect(blocks[1]).toMatchObject({ wrap: false, indent: blocks[0].indent + 6 });
        expect(blocks[3]).toMatchObject({ wrap: false, indent: blocks[2].indent + 6 });
        // A fence at the top level keeps its small inset.
        expect(parseMarkdown('```\nx\n```')[0].indent).toBe(6);
    });

    it('reads a table as rows of cells that share the width, with a bold first row', () => {
        const blocks = parseMarkdown('Before\n| Name | Size |\n| --- | ---: |\n| a.js | **1** KB |\n| b.js | 2 KB |\n\nAfter');
        expect(textOf([blocks[0], blocks[4]])).toEqual(['Before', 'After']);
        const rows = blocks.slice(1, 4);
        expect(rows.map(row => row.cells.map(cell => textOf(cell.blocks)[0]))).toEqual([
            ['Name', 'Size'],
            ['a.js', '1 KB'],
            ['b.js', '2 KB'],
        ]);
        expect(rows.every(row => row.cells.every(cell => cell.width === 0))).toBe(true);
        expect(rows.map(row => row.cells[0].blocks[0].runs[0].bold)).toEqual([true, false, false]);
    });

    it('reads a line with a bar as text when no table follows', () => {
        expect(textOf(parseMarkdown('a | b\nc'))).toEqual(['a | b c']);
    });

    it('draws no more columns than a page has room for', () => {
        const [header] = parseMarkdown(`${'| a '.repeat(40)}|\n${'|---'.repeat(40)}|`);
        expect(header.cells.length).toBeLessThan(10);
    });

    it.each([
        ['marks that never close', '*a '],
        ['brackets that never close', '[a]('],
        ['tags that never close', '<a '],
        ['spaces before a letter, in a heading', '# \t '],
        ['bars', '| a '],
    ])('reads a line that is all %s in good time', (_label, unit) => {
        const start = performance.now();
        parseMarkdown(unit.repeat(8000));
        expect(performance.now() - start).toBeLessThan(500);
    });
});

describe('readMarkdownPreview', () => {
    it('lays the document out on a small page, wrapping text to its width', async () => {
        const lines = await draw(`# Title\n\n${'word '.repeat(30)}\n\n- item\n`);
        expect(drawn).toMatchObject({ width: 198, height: 256 });
        expect(lines[0]).toMatchObject({ text: 'Title', x: 18, font: 'bold 22px sans-serif' });
        // The paragraph takes more than one line, all starting at the left margin.
        const paragraph = lines.filter(line => line.text.startsWith('word'));
        expect(paragraph.length).toBeGreaterThan(1);
        expect(paragraph.every(line => line.x === 18 && line.font === '11px sans-serif')).toBe(true);
        expect(drawn.text.every(word => word.x < 255 - 18)).toBe(true);
        // The marker hangs between the margin and the item's text.
        const marker = drawn.text.find(word => word.text === '•');
        const item = drawn.text.find(word => word.text === 'item');
        expect(marker.x).toBeGreaterThan(18);
        expect(item.x).toBeGreaterThan(marker.x);
        expect(item.y).toBe(marker.y);
    });

    it('draws the cells of a table row side by side', async () => {
        await draw('| Name | Size |\n|---|---|\n| a.js | 1 KB |');
        const [name, size, file] = ['Name', 'Size', 'a.js'].map(text => drawn.text.find(word => word.text === text));
        expect(size.y).toBe(name.y);
        expect(size.x).toBeGreaterThan(name.x + 100);
        expect(file).toMatchObject({ x: name.x });
        expect(file.y).toBeGreaterThan(name.y);
    });

    it('draws code in a fixed-width font, off the edge of the page when it is long', async () => {
        const lines = await draw(`\`\`\`\n${'word '.repeat(40)}\nnext\n\`\`\``);
        expect(lines.map(line => line.font)).toEqual(['9.5px monospace', '9.5px monospace']);
        expect(lines[1].text).toBe('next');
    });

    it.each([
        ['a file with no text', '\n\n  \n'],
        ['a file of pictures alone', '![a](a.png)\n\n<img src="b.png">\n'],
        ['a file that is not text', 'PK\x03\x04\0\0\0\0'],
    ])('makes nothing of %s', async (_label, content) => {
        expect(await readMarkdownPreview(new File([content], 'README.md'))).toBeUndefined();
    });
});
