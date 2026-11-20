import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingCanvas, linesOf } from '../../../tests/fixtures/canvas.js';
import { colorCode, indentJson, readCodePreview } from './code.js';
import { TEXT_MAX_READ_BYTES } from './config.js';

const colorOf = (sample, language = 'javascript') => colorCode(sample, language)[0].color;
const PLAIN = colorOf('x');
const COMMENT = colorOf('// x');
const STRING = colorOf('"x"');
const KEYWORD = colorOf('const');
const NUMBER = colorOf('1');
const NAME = colorOf('f()');
const PROPERTY = colorOf('color: red;', 'css');
/** The text and color of each run, with the runs of plain text between tokens left out. */
const tokens = (text, language) => colorCode(text, language)
    .filter(run => run.color !== PLAIN)
    .map(run => [run.text, run.color]);

let drawn;
const draw = async (text, name = 'app.js', language = 'javascript') => {
    const preview = await readCodePreview(new File([text], name), language);
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

describe('colorCode', () => {
    it('gives each kind of token a color of its own', () => {
        expect(new Set([PLAIN, COMMENT, STRING, KEYWORD, NUMBER, NAME]).size).toBe(6);
    });

    it('colors the tokens of JavaScript and leaves the rest plain', () => {
        const runs = colorCode('const total = sum(1, "two"); // done', 'javascript');
        expect(runs.map(run => [run.text, run.color])).toEqual([
            ['const', KEYWORD],
            [' total = ', PLAIN],
            ['sum', NAME],
            ['(', PLAIN],
            ['1', NUMBER],
            [', ', PLAIN],
            ['"two"', STRING],
            ['); ', PLAIN],
            ['// done', COMMENT],
        ]);
        expect(runs.every(run => run.family === 'monospace' && !run.bold && !run.italic)).toBe(true);
    });

    it('draws plain text in one plain run', () => {
        const source = 'const a = "b"; // c\n<p>1</p>';
        expect(colorCode(source, 'text').map(run => [run.text, run.color])).toEqual([[source, PLAIN]]);
    });

    it('puts every character of the source in a run, in order', () => {
        const source = 'if (a) {\n\treturn `x${a}`;\n}\n/* end';
        expect(colorCode(source, 'javascript').map(run => run.text).join('')).toBe(source);
    });

    it.each([
        ['a comment over several lines', '/* one\n two */ x', [['/* one\n two */', COMMENT]]],
        ['a comment that never ends', 'x /* one\n two', [['/* one\n two', COMMENT]]],
        ['a template over several lines', '`a\n${b}` + 1', [['`a\n${b}`', STRING], ['1', NUMBER]]],
        ['a string that ends with its line', '\'open\nlet', [['\'open', STRING], ['let', KEYWORD]]],
        ['an escaped quote in a string', '"a\\"b" in', [['"a\\"b"', STRING], ['in', KEYWORD]]],
        ['a comment mark inside a string', '"http://x" // y', [['"http://x"', STRING], ['// y', COMMENT]]],
        ['a keyword inside a longer name', 'constant, newest, $let, do_it', []],
        ['numbers in their forms', '0xFF 1_000n 1.5e-3 a1', [['0xFF', NUMBER], ['1_000n', NUMBER], ['1.5e-3', NUMBER]]],
        ['values written as words', 'null true', [['null', NUMBER], ['true', NUMBER]]],
        ['a keyword before a bracket', 'if (x) while(y)', [['if', KEYWORD], ['while', KEYWORD]]],
    ])('reads %s', (_label, source, expected) => {
        expect(tokens(source, 'javascript')).toEqual(expected);
    });

    it('tells the properties of CSS from its selectors', () => {
        expect(tokens('a:hover, .card > #main {\n  color: #fff;\n  margin: -2px 1.5em;\n  --gap: 10%\n}', 'css')).toEqual([
            ['.card', NAME],
            ['#main', NAME],
            ['color', PROPERTY],
            ['#fff', NUMBER],
            ['margin', PROPERTY],
            ['-2px', NUMBER],
            ['1.5em', NUMBER],
            ['--gap', PROPERTY],
            ['10%', NUMBER],
        ]);
    });

    it.each([
        ['at-rules and what overrides them', '@media print { a { b: c !important } }', [['@media', KEYWORD], ['b', PROPERTY], ['!important', KEYWORD]]],
        ['comments and strings', '/* a: b; */ a { content: "x: y;" }', [['/* a: b; */', COMMENT], ['content', PROPERTY], ['"x: y;"', STRING]]],
        ['a number inside a name', 'h1, .col-2 { }', [['.col-2', NAME]]],
        ['a selector spread over lines', 'a:link,\nb:visited { }', []],
    ])('reads %s in CSS', (_label, source, expected) => {
        expect(tokens(source, 'css')).toEqual(expected);
    });
});

describe('colorCode for JSON', () => {
    it('tells keys from the strings they hold', () => {
        const runs = colorCode('{ "name": "Ada", "age": 36, "ok": true, "x": null }', 'json');
        const kinds = runs.filter(run => run.color !== PLAIN).map(run => [run.text, run.color]);
        expect(kinds).toEqual([
            ['"name"', PROPERTY],
            ['"Ada"', STRING],
            ['"age"', PROPERTY],
            ['36', NUMBER],
            ['"ok"', PROPERTY],
            ['true', NUMBER],
            ['"x"', PROPERTY],
            ['null', NUMBER],
        ]);
    });

    it.each([
        ['comments', '// a\n/* b */ 1', [['// a', COMMENT], ['/* b */', COMMENT], ['1', NUMBER]]],
        ['a colon inside a string', '"a: b"', [['"a: b"', STRING]]],
        ['an escaped quote in a key', '"a\\"b": -1.5e3', [['"a\\"b"', PROPERTY], ['-1.5e3', NUMBER]]],
        ['a string the read cut off', '"key": "open', [['"key"', PROPERTY], ['"open', STRING]]],
        ['a number inside a word', 'a1 truest', []],
    ])('reads %s', (_label, source, expected) => {
        expect(tokens(source, 'json')).toEqual(expected);
    });
});

describe('indentJson', () => {
    it('puts each member and element on a line of its own, two spaces in a level', () => {
        expect(indentJson('{"a":1,"b":[true,{"c":"x,y"}],"d":{},"e":[]}')).toBe([
            '{',
            '  "a": 1,',
            '  "b": [',
            '    true,',
            '    {',
            '      "c": "x,y"',
            '    }',
            '  ],',
            '  "d": {},',
            '  "e": []',
            '}',
        ].join('\n'));
    });

    it('starts each value of JSON Lines on a line of its own', () => {
        expect(indentJson('{"a":1}\n[2]')).toBe('{\n  "a": 1\n}\n[\n  2\n]');
    });

    it('keeps the comments of a settings file', () => {
        expect(indentJson('{"a":1,// why\n"b":/* c */2}')).toBe('{\n  "a": 1,\n  // why\n  "b": /* c */ 2\n}');
    });

    it('sets a comment inside a line apart from the tokens around it', () => {
        expect(indentJson('[1/* a */,2// b\n]')).toBe('[\n  1 /* a */,\n  2 // b\n]');
    });

    it('puts what follows a comment that starts a line on the next line', () => {
        expect(indentJson('/* Copyright 2024, A */{"a":1}')).toBe('/* Copyright 2024, A */\n{\n  "a": 1\n}');
    });

    it('lays out JSON the read cut off', () => {
        expect(indentJson('[{"a":"open')).toBe('[\n  {\n    "a": "open');
    });

    it('stops after more lines than a page shows, however deep the nesting goes', () => {
        const lines = indentJson('['.repeat(TEXT_MAX_READ_BYTES)).split('\n');
        expect(lines.length).toBeLessThanOrEqual(64);
        expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(40);
    });
});

describe('readCodePreview', () => {
    it('draws the lines of the file top to bottom in a fixed-width font, on a small page', async () => {
        const lines = await draw('const a = 1;\n\n  return a;\n');
        // A token is drawn on its own, so the number and the `;` after it come back as two words.
        expect(lines.map(line => line.text)).toEqual(['const a = 1 ;', 'return a;']);
        expect(drawn).toMatchObject({ width: 198, height: 256 });
        expect(drawn.text.every(word => word.font === '10px monospace')).toBe(true);
        // Two spaces of indent, each half the font size wide in the recording canvas.
        expect(lines[1].x - lines[0].x).toBe(10);
        // The empty second line still takes a line.
        expect(lines[1].y - lines[0].y).toBe(24);
        expect(drawn.text.find(word => word.text === 'const').color).toBe(KEYWORD);
    });

    it('lets a long line run off the page instead of wrapping it', async () => {
        const lines = await draw(`${'word '.repeat(40)}\nnext`);
        expect(lines).toHaveLength(2);
        expect(lines[1].text).toBe('next');
        // Words are drawn up to the one that crosses the right margin, and no further. A word and its space are 25 wide.
        const last = Math.max(...drawn.text.map(word => word.x));
        expect(last).toBeGreaterThan(255 - 18 - 25);
        expect(last).toBeLessThanOrEqual(255 - 18);
    });

    it('measures a minified file only as far as the page goes', async () => {
        const lines = await draw('a=b+1;'.repeat(2000).replace(/;/g, '; '));
        expect(lines).toHaveLength(1);
        expect(drawn.measured).toBeLessThan(200);
    });

    it('starts lines at the left edge whatever script their first letter is in', async () => {
        const lines = await draw('// שלום\nconst a = 1;');
        expect(lines.map(line => line.x)).toEqual([18, 18]);
    });

    it('draws a tab as four spaces and reads Windows line endings', async () => {
        const lines = await draw('a\r\n\tb\r\n');
        expect(lines.map(line => line.text)).toEqual(['a', 'b']);
        expect(lines[1].x - lines[0].x).toBe(20);
        expect(lines[1].y - lines[0].y).toBe(12);
    });

    it('stops at the bottom of the page', async () => {
        const lines = await draw(Array.from({ length: 200 }, (_, index) => `line${index}`).join('\n'));
        expect(lines.length).toBeGreaterThan(20);
        expect(lines.length).toBeLessThan(30);
        expect(lines[0].text).toBe('line0');
    });

    it('colors a stylesheet as CSS', async () => {
        await draw('a { color: red; }', 'site.css', 'css');
        expect(drawn.text.find(word => word.text === 'color').color).toBe(PROPERTY);
    });

    it('draws JSON written on one line indented, and other JSON as it is written', async () => {
        let lines = await draw('{"name":"Ada","tags":["a"]}', 'data.json', 'json');
        expect(lines.map(line => line.text)).toEqual(['{', '"name" : "Ada" ,', '"tags" : [', '"a"', ']', '}']);
        expect(lines[1].x - lines[0].x).toBe(10);
        drawn.text.length = 0;
        lines = await draw('{\n    "a": [1, 2]\n}', 'data.json', 'json');
        expect(lines.map(line => line.text)).toEqual(['{', '"a" : [ 1 , 2 ]', '}']);
        expect(lines[1].x - lines[0].x).toBe(20);
    });

    it('reads only the start of a large file', async () => {
        const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
        const lines = await draw(`first\n${'x\n'.repeat(TEXT_MAX_READ_BYTES)}`);
        expect(lines[0].text).toBe('first');
        expect(read.mock.contexts.map(blob => blob.size)).toEqual([TEXT_MAX_READ_BYTES]);
    });

    it.each([
        ['an empty file', ''],
        ['a file of blank lines', ' \n\t\n\n'],
        ['a file that is not text', 'MZ\0\0\x03\0\0\0code'],
    ])('makes nothing of %s', async (_label, content) => {
        expect(await readCodePreview(new File([content], 'app.js'), 'javascript')).toBeUndefined();
    });
});
