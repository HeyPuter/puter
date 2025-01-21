/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const {
    StringStream,
    LinesCommentParser,
    BlockCommentParser,
    CommentParser
} = require('../main');

const assert = async (label, fn) => {
    if ( ! await fn() ) {
        // TODO: strutil quot
        throw new Error(`assert: '${label}' failed`)
    }
};

describe('parsers', () => {
    describe('lines-comment-parser', () => {
        it ('basic test', async () => {
            const parser = LinesCommentParser({ prefix: '//' });
            let lines;
            const ss = StringStream(`
                // first line of  first block
                // second line of first block
                
                // first line of second block
                
                function () {}
            `);
            const results = [];
            for (;;) {
                comment = await parser.parse(ss);
                if ( ! comment ) break;
                results.push(comment.lines);
            }
            console.log('results?', results);
        })
    })
    describe('block-comment-parser', () => {
        it ('basic test', async () => {
            const parser = BlockCommentParser({
                start: '/*',
                end: '*/',
                ignore_line_prefix: '*',
            });
            let lines;
            const ss = StringStream(`
                /*
                First block
                comment
                */
                /*
                 * second block
                 * comment
                 */
                
                /**
                 * third block
                 * comment
                 */
                function () {}
            `);
            const results = [];
            for (;;) {
                comment = await parser.parse(ss);
                if ( ! comment ) break;
                results.push(comment.lines);
            }
            console.log('results?', results);
        })
        it ('doesn\'t return anything for line comments', async () => {
            const parser = BlockCommentParser({
                start: '/*',
                end: '*/',
                ignore_line_prefix: '*',
            });
            let lines;
            const ss = StringStream(`
                // this comment should not be parsed
                // by the block comment parser
                function () {}
            `);
            const results = [];
            for (;;) {
                comment = await parser.parse(ss);
                if ( ! comment ) break;
                results.push(comment.lines);
            }
            console.log('results?', results);
        })
    })
    describe('extract_top_comments', () => {
        it ('basic test', async () => {
            const parser = CommentParser();
            
            const filename = 'test.js';
            const source = `
                // First lines comment
                // second line of lines comment
                
                /*
                First block comment
                second line of block comment
                */
            `;
        
            const results = await parser.extract_top_comments({
                filename,
                source,
            });
            console.log('results?', results);
        })
    })
    describe('StringStream', () => {
        describe('fork', () => {
            it('works', async () => {
                const ss = StringStream('asdf');
                const ss_ = ss.fork();
                ss_.fwd();
                await assert('fwd worked', async () => {
                    return await ss_.get_char() === 's';
                });
                await assert('upstream state is same', async () => {
                    return await ss.get_char() === 'a';
                });
            })
        })
    })
});
