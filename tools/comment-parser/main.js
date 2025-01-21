// METADATA // {"ai-commented":{"service":"claude"}}
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

const lib = {};
lib.dedent_lines = lines => {
    // If any lines are just spaces, remove the spaces
    for ( let i=0 ; i < lines.length ; i++ ) {
        if ( /^\s+$/.test(lines[i]) ) lines[i] = '';
    }
    
    // Remove leading and trailing blanks
    while ( lines[0] === '' ) lines.shift();
    while ( lines[lines.length-1] === '' ) lines.pop();

    let min_indent = Number.MAX_SAFE_INTEGER;
    for ( let i=0 ; i < lines.length ; i++ ) {
        if ( lines[i] === '' ) continue;
        let n_spaces = 0;
        for ( let j=0 ; j < lines[i].length ; j++ ) {
            if ( lines[i][j] === ' ' ) n_spaces++;
            else break;
        }
        if ( n_spaces < min_indent ) min_indent = n_spaces;
    }
    for ( let i=0 ; i < lines.length ; i++ ) {
        if ( lines[i] === '' ) continue;
        lines[i] = lines[i].slice(min_indent);
    }
};


/**
* Creates a StringStream object for parsing a string with position tracking
* @param {string} str - The string to parse
* @param {Object} [options] - Optional configuration object
* @param {Object} [options.state_] - Initial state with position
* @returns {Object} StringStream instance with parsing methods
*/
const StringStream = (str, { state_ } = {}) => {
    const state = state_ ?? { pos: 0 };
    return {
        skip_whitespace () {
            while ( /^\s/.test(str[state.pos]) ) state.pos++;
        },
        // INCOMPLETE: only handles single chars
        skip_matching (items) {
            while ( items.some(item => {
                return str[state.pos] === item;
            }) ) state.pos++;
        },
        fwd (amount) {
            state.pos += amount ?? 1;
        },
        fork () {
            return StringStream(str, { state_: { pos: state.pos } });
        },
        async get_pos () {
            return state.pos;
        },
        async get_char () {
            return str[state.pos];
        },
        async matches (re_or_lit) {
            if ( re_or_lit instanceof RegExp ) {
                const re = re_or_lit;
                return re.test(str.slice(state.pos));
            }
            
            const lit = re_or_lit;
            return lit === str.slice(state.pos, state.pos + lit.length);
        },
        async get_until (re_or_lit) {
            let index;
            if ( re_or_lit instanceof RegExp ) {
                const re = re_or_lit;
                const result = re.exec(str.slice(state.pos));
                if ( ! result ) return;
                index = state.pos + result.index;
            } else {
                const lit = re_or_lit;
                const ind = str.slice(state.pos).indexOf(lit);
                // TODO: parser warnings?
                if ( ind === -1 ) return;
                index = state.pos + ind;
            }
            const start_pos = state.pos;
            state.pos = index;
            return str.slice(start_pos, index);
        },
        async debug () {
            const l1 = str.length;
            const l2 = str.length - state.pos;
            const clean = s => s.replace(/\n/, '{LF}');
            return `[stream : "${
                clean(str.slice(0, Math.min(6, l1)))
            }"... |${state.pos}| ..."${
                clean(str.slice(state.pos, state.pos + Math.min(6, l2)))
            }"]`
        }
    };
};

const LinesCommentParser = ({
    prefix
}) => {
    return {
        parse: async (stream) => {
            stream.skip_whitespace();
            const lines = [];
            while ( await stream.matches(prefix) ) {
                const line = await stream.get_until('\n');
                if ( ! line ) return;
                lines.push(line);
                stream.fwd();
                stream.skip_matching([' ', '\t']);
                if ( await stream.get_char() === '\n' ){
                    stream.fwd();
                    break;
                }
                stream.skip_whitespace();
            }
            if ( lines.length === 0 ) return;
            for ( let i=0 ; i < lines.length ; i++ ) {
                lines[i] = lines[i].slice(prefix.length);
            }
            lib.dedent_lines(lines);
            return {
                lines,
            };
        }
    };
};

const BlockCommentParser = ({
    start,
    end,
    ignore_line_prefix,
}) => {
    return {
        parse: async (stream) => {
            stream.skip_whitespace();
            if ( ! await stream.matches(start) ) return;
            stream.fwd(start.length);
            const contents = await stream.get_until(end);
            if ( ! contents ) return;
            stream.fwd(end.length);
            // console.log('ending at', await stream.debug())
            const lines = contents.split('\n');
            
            // === Formatting Time! === //
            
            // Special case: remove the last '*' after '/**'
            if ( lines[0].trim() === ignore_line_prefix ) {
                lines.shift();
            }
            
            // First dedent pass
            lib.dedent_lines(lines);
            
            // If all the lines start with asterisks, remove
            let allofem = true;
            for ( let i=0 ; i < lines.length ; i++ ) {
                if ( lines[i] === '' ) continue;
                if ( ! lines[i].startsWith(ignore_line_prefix) ) {
                    allofem = false;
                    break
                }
            }
            
            if ( allofem ) {
                for ( let i=0 ; i < lines.length ; i++ ) {
                    if ( lines[i] === '' ) continue;
                    lines[i] = lines[i].slice(ignore_line_prefix.length);
                }
                
                // Second dedent pass
                lib.dedent_lines(lines);
            }
            
            return { lines };
        }
    };
};


/**
* Creates a writer for line-style comments with a specified prefix
* @param {Object} options - Configuration options
* @param {string} options.prefix - The prefix to use for each comment line
* @returns {Object} A comment writer object
*/
const LinesCommentWriter = ({ prefix }) => {
    return {
        write: (lines) => {
            lib.dedent_lines(lines);
            for ( let i=0 ; i < lines.length ; i++ ) {
                lines[i] = prefix + lines[i];
            }
            return lines.join('\n') + '\n';
        }
    };
};


/**
* Creates a block comment writer with specified start/end markers and prefix
* @param {Object} options - Configuration options
* @param {string} options.start - Comment start marker (e.g. "/*")
* @param {string} options.end - Comment end marker (e.g. "* /") 
* @param {string} options.prefix - Line prefix within comment (e.g. " * ")
* @returns {Object} Block comment writer object
*/
const BlockCommentWriter = ({ start, end, prefix }) => {
    return {
        write: (lines) => {
            lib.dedent_lines(lines);
            for ( let i=0 ; i < lines.length ; i++ ) {
                lines[i] = prefix + lines[i];
            }
            let s = start + '\n';
            s += lines.join('\n') + '\n';
            s += end + '\n';
            return s;
        }
    };
};


/**
* Creates a new CommentParser instance for parsing and handling source code comments
* 
* @returns {Object} An object with methods:
*   - supports: Checks if a file type is supported
*   - extract_top_comments: Extracts comments from source code
*   - output_comment: Formats and outputs comments in specified style
*/
const CommentParser = () => {
    const registry_ = {
        object: {
            parsers: {
                lines: LinesCommentParser,
                block: BlockCommentParser,
            },
            writers: {
                lines: LinesCommentWriter,
                block: BlockCommentWriter,
            },
        },
        data: {
            extensions: {
                js: 'javascript',
                cjs: 'javascript',
                mjs: 'javascript',
            },
            languages: {
                javascript: {
                    parsers: [
                        ['lines', {
                            prefix: '//',
                        }],
                        ['block', {
                            start: '/*',
                            end: '*/',
                            ignore_line_prefix: '*',
                        }],
                    ],
                    writers: {
                        lines: ['lines', {
                            prefix: '// '
                        }],
                        block: ['block', {
                            start: '/*',
                            end: ' */',
                            prefix: ' * ',
                        }]
                    },
                }
            },
        }
        
    };
    

    /**
    * Gets the language configuration for a given filename by extracting and validating its extension
    * @param {Object} params - The parameters object
    * @param {string} params.filename - The filename to get the language for
    * @returns {Object} Object containing the language configuration
    */
    const get_language_by_filename = ({ filename }) => {
        const { language } = (({ filename }) => {
            const { language_id } = (({ filename }) => {
                const { extension } = (({ filename }) => {
                    const components = ('' + filename).split('.');
                    const extension = components[components.length - 1];
                    return { extension };
                })({ filename });
                
                const language_id = registry_.data.extensions[extension];
                
                if ( ! language_id ) {
                    throw new Error(`unrecognized language id: ` +
                        language_id);
                }
                return { language_id };
            })({ filename });
            
            const language = registry_.data.languages[language_id];
            return { language };
        })({ filename });

        if ( ! language ) {
            // TODO: use strutil quot here
            throw new Error(`unrecognized language: ${language}`)
        }
        
        return { language };
    }
    

    /**
    * Checks if a given filename is supported by the comment parser
    * @param {Object} params - The parameters object
    * @param {string} params.filename - The filename to check support for
    * @returns {boolean} Whether the file type is supported
    */
    const supports = ({ filename }) => {
        try {
            get_language_by_filename({ filename });
        } catch (e) {
            return false;
        }
        return true;
    };
    
    const extract_top_comments = async ({ filename, source }) => {
        const { language } = get_language_by_filename({ filename });
        
        // TODO: registry has `data` and `object`...
        //       ... maybe add `virt` (virtual), which will
        //       behave in the way the above code is written.

        const inst_ = spec => registry_.object.parsers[spec[0]](spec[1]);
        
        let ss = StringStream(source);
        const results = [];
        for (;;) {
            let comment;
            for ( let parser of language.parsers ) {
                const parser_name = parser[0];
                parser = inst_(parser);

                const ss_ = ss.fork();
                const start_pos = await ss_.get_pos();
                comment = await parser.parse(ss_);
                const end_pos = await ss_.get_pos();
                if ( comment ) {
                    ss = ss_;
                    comment.type = parser_name;
                    comment.range = [start_pos, end_pos];
                    break;
                }
            }
            // console.log('comment?', comment);
            if ( ! comment ) break;
            results.push(comment);
        }
        
        return results;
    }
    

    /**
    * Outputs a comment in the specified style for a given filename and text
    * @param {Object} params - The parameters object
    * @param {string} params.filename - The filename to determine comment style
    * @param {string} params.style - The comment style to use ('lines' or 'block')
    * @param {string} params.text - The text content of the comment
    * @returns {string} The formatted comment string
    */
    const output_comment = ({ filename, style, text }) => {
        const { language } = get_language_by_filename({ filename });
        
        const inst_ = spec => registry_.object.writers[spec[0]](spec[1]);
        let writer = language.writers[style];
        writer = inst_(writer);
        const lines = text.split('\n');
        const s = writer.write(lines);
        return s;
    }
    
    return {
        supports,
        extract_top_comments,
        output_comment,
    };
};

module.exports = {
    StringStream,
    LinesCommentParser,
    BlockCommentParser,
    CommentParser,
};
