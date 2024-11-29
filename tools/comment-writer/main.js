const enq = require('enquirer');
const wrap = require('word-wrap');
const dedent = require('dedent');
const axios = require('axios');

const { walk, EXCLUDE_LISTS } = require('../file-walker/test');

const https = require('https');
const fs = require('fs');
const path_ = require('path');

const FILE_EXCLUDES = [
    /^\.git/,
    /^node_modules\//,
    /\/node_modules$/,
    /^node_modules$/,
    /package-lock\.json/,
    /^src\/dev-center\/js/,
    /src\/backend\/src\/public\/assets/,
    /^src\/gui\/src\/lib/,
    /^eslint\.config\.js$/,
];

const axi = axios.create({
    httpsAgent: new https.Agent({  
        rejectUnauthorized: false
    })
});

const cwd = process.cwd();
const context = {};

context.config = JSON.parse(
    fs.readFileSync('config.json')
);

class AI {
    constructor (context) {
        //
    }
    
    async complete ({ messages }) {
        const response = await axi.post(`${context.config.api_url}/drivers/call`, {
            interface: 'puter-chat-completion',
            method: 'complete',
            args: {
                messages,
            },
        }, {
            headers: {
                "Content-Type": "application/json",
                Origin: 'https://puter.local',
                Authorization: `Bearer ${context.config.auth_token}`,
            },
        });
        
        return response.data.result.message;
    }
}

class CommentWriter {
    //
}

class JavascriptFileProcessor {
    constructor (context, parameters) {
        this.context = context;
        this.parameters = parameters;
    }
    
    process (lines) {
        const definitions = [];
        for ( let i = 0 ; i < lines.length ; i++ ) {
            const line = lines[i];
            for ( const matcher of this.parameters.definition_matchers ) {
                const match = matcher.pattern.exec(line);
                console.log('match object', match);

                if ( match ) {
                    definitions.push({
                        ...matcher.handler(match),
                        line: i,
                    });
                    break;
                }
            }
        }
        return { definitions };
    }
}

const js_processor = new JavascriptFileProcessor(context, {
    definition_matchers: [
        // {
        //     name: 'require',
        //     pattern: /const (\w+) = require\(['"](.+)['"]\);/,
        //     handler: (match) => {
        //         const [ , name, path ] = match;
        //         return {
        //             type: 'require',
        //             name,
        //             path,
        //         };
        //     }
        // },
        {
            name: 'class',
            pattern: /class (\w+)(?: extends (.+))? {/,
            handler: (match) => {
                const [ , name, parent ] = match;
                return {
                    type: 'class',
                    name,
                    parent,
                };
            }
        },
        {
            name: 'method',
            pattern: /^\s*async .*\(.*\).*{/,
            handler: (match) => {
                const [ , name ] = match;
                return {
                    async: true,
                    type: 'method',
                    name,
                };
            }
        },
        {
            name: 'method',
            pattern: /^\s*[A-Za-z_\$]+.*\(\).*{/,
            handler: (match) => {
                const [ , name ] = match;
                return {
                    type: 'method',
                    name,
                };
            }
        },
        {
            name: 'function',
            pattern: /^\s*function .*\(.*\).*{/,
            handler: (match) => {
                const [ , name ] = match;
                return {
                    type: 'function',
                    scope: 'function',
                    name,
                };
            }
        },
        {
            name: 'function',
            pattern: /const [A-Za-z_]+\s*=\s*\(.*\)\s*=>\s*{/,
            handler: (match) => {
                const [ , name, args ] = match;
                return {
                    type: 'function',
                    scope: 'lexical',
                    name,
                    args: args.split(',').map(arg => arg.trim()),
                };
            }
        },
        {
            name: 'const',
            // pattern to match only uppercase-lettered variable names
            pattern: /const ([A-Z_]+) = (.+);/,
            handler: (match) => {
                const [ , name, value ] = match;
                return {
                    type: 'const',
                    name,
                    value,
                };
            }
        }
    ],
});

const create_limited_view = (lines, key_places) => {
    // Sort key places by starting line
    key_places.sort((a, b) => {
        const a_start = Math.max(0, a.anchor - a.lines_above);
        const b_start = Math.max(0, b.anchor - b.lines_above);
        return a_start - b_start;
    });
    
    const visible_ranges = [];
    
    // Create visible ranges for each key place
    for ( const key_place of key_places ) {
        const anchor = key_place.anchor;
        const lines_above = key_place.lines_above;
        const lines_below = key_place.lines_below;
        
        const start = Math.max(0, anchor - lines_above);
        const end = Math.min(lines.length, anchor + lines_below);
        
        visible_ranges.push({
            anchor: key_place.anchor,
            comment: key_place.comment,
            start,
            end,
        });
    }
    
    // Merge overlapping visible ranges
    const merged_ranges = [];
    
    for ( const range of visible_ranges ) {
        range.comments = [{
            anchor: range.anchor,
            text: range.comment
        }];

        if ( ! merged_ranges.length ) {
            merged_ranges.push(range);
            continue;
        }
        
        const last_range = merged_ranges[merged_ranges.length - 1];
        
        if ( last_range.end >= range.start ) {
            last_range.end = Math.max(last_range.end, range.end);
            last_range.comments.push({
                anchor: range.anchor,
                text: range.comment
            });
        } else {
            merged_ranges.push(range);
        }
    }
    
    // Create the limited view, adding line numbers and comments
    let limited_view = '';
    
    let previous_visible_range = null;
    for ( let i = 0 ; i < lines.length ; i++ ) {
        const line = lines[i];
        
        let visible_range = null;
        
        if ( i === 22 ) debugger;

        for ( const range of merged_ranges ) {
            if ( i >= range.start && i < range.end ) {
                visible_range = range;
                break;
            }
        }
        
        // console.log('visible_range', visible_range, i);
        
        if ( visible_range === null ) {
            continue;
        }
        
        if ( visible_range !== previous_visible_range ) {
            if ( i !== 0 ) limited_view += '\n';
            if ( visible_range.comments.length === 1 ) {
                const comment = visible_range.comments[0];
                limited_view += `window around line ${comment.anchor}: ${comment.text}\n`;
            } else {
                limited_view += `window around lines ${visible_range.comments.length} key lines:\n`;
                for ( const comment of visible_range.comments ) {
                    limited_view += `- line ${comment.anchor}: ${comment.text}\n`;
                }
            }
        }
        
        previous_visible_range = visible_range;
        
        limited_view += `${i + 1}: ${line}\n`;
    }
    
    return limited_view;
};

/**
 * Inject comments into lines
 * @param {*} lines - Array of original file lines
 * @param {*} comments - Array of comment objects
 * 
 * Comment object structure:
 * {
 *    position: 0, // Position in lines array
 *    lines: [ 'comment line 1', 'comment line 2', ... ]
 * }
 */
const inject_comments = (lines, comments) => {
    // Sort comments in reverse order
    comments.sort((a, b) => b.position - a.position);
    
    // Inject comments into lines
    for ( const comment of comments ) {
        // AI might have been stupid and added a comment above a blank line,
        // despite that we told it not to do that. So we need to adjust the position.
        while ( comment.position < lines.length && ! lines[comment.position].trim() ) {
            comment.position++;
        }
        
        const indentation = lines[comment.position].match(/^\s*/)[0];
        console.log('????', comment.position, lines[comment.position], '|' + indentation + '|');
        const comment_lines = comment.lines.map(line => `${indentation}${line}`);
        lines.splice(comment.position, 0, ...comment_lines);
    }
}

const textutil = {};
textutil.format = text => {
    return wrap(dedent(text), {
        width: 80,
        indent: '| '
    });
};

context.ai = new AI(context);

const main = async () => {
    // const message = await context.ai.complete({
    //     messages: [
    //         {
    //             role: 'user',
    //             content: `
    //                 Introduce yourself as the Puter Comment Writer. You are an AI that will
    //                 write comments in code files. A file walker will be used to iterate over
    //                 the source files and present them one at a time, and the user will accept,
    //                 reject, or request edits interactively. For each new file, a clean AI
    //                 context will be created.
    //             `.trim()
    //         }
    //     ]
    // });
    // const intro = message.content;
    const intro = textutil.format(`
        Hello! I am the Puter Comment Writer, an AI designed to enhance your code files with meaningful comments. As you walk through your source files, I will provide insights, explanations, and clarifications tailored to the specific content of each file. You can choose to accept my comments, request edits for more clarity or detail, or even reject them if they don't meet your needs. Each time we move to a new file, I'll start fresh with a clean context, ready to help you improve your code documentation. Let's get started!
    `);
    console.log(intro);
    
    console.log(`Enter a path relative to: ${process.cwd()}`);
    console.log('arg?', process.argv[2]);
    let rootpath = process.argv[2] ? { path: process.argv[2] } : await enq.prompt({
        type: 'input',
        name: 'path',
        message: 'Enter path:'
    });
    
    rootpath = path_.resolve(rootpath.path);
    console.log('rootpath:', rootpath);

    const walk_iter = walk({
        excludes: FILE_EXCLUDES,
    }, rootpath);
    
    for await ( const value of walk_iter ) {
        if ( value.is_dir ) {
            console.log('directory:', value.path);
            continue;
        }
        if ( ! value.name.endsWith('.js') ) {
            continue;
        }
        console.log('file:', value.path);
        const lines = fs.readFileSync(value.path, 'utf8').split('\n');
        
        if ( lines[0].startsWith('// METADATA // ') ) {
            const metadata = JSON.parse(lines[0].slice('// METADATA // '.length));
            if ( metadata['ai-commented'] ) {
                console.log('File was already commented by AI; skipping...');
                continue;
            }
        }
        
        const action = await enq.prompt({
            type: 'select',
            name: 'action',
            message: 'Select action:',
            choices: [
                'generate',
                'skip',
                'exit',
            ]
        })
        
        if ( action.action === 'exit' ) {
            break;
        }
        
        if ( action.action === 'skip' ) {
            continue;
        }

        const { definitions } = js_processor.process(lines);
        const key_places = [];
        key_places.push({
            anchor: 0,
            lines_above: 2,
            lines_below: 200,
            comment: `Top of file: ${value.path}`
        });
        key_places.push({
            anchor: lines.length - 1,
            lines_above: 200,
            lines_below: 2,
            comment: `Bottom of ${value.name}`
        });
        for ( const definition of definitions ) {
            key_places.push({
                anchor: definition.line,
                lines_above: 40,
                lines_below: 40,
                comment: `${definition.type}.`
            });
        }
        let limited_view = create_limited_view(lines, key_places);
        console.log('--- view ---');
        console.log(limited_view);
        
        const comments = [];
        // comments.push({
        //     position: 0,
        // });
        // for ( const definition of definitions ) {
        //     comments.push({
        //         position: definition.line,
        //         definition,
        //     });
        // }
        
        // This was worth a try but the LLM is very bad at this
        /*
        const message = await context.ai.complete({
            messages: [
                {
                    role: 'user',
                    content: dedent(`
                        Respond with comma-separated numbers only, with no surrounding text.
                        Please write the numbers of the lines above which a comment should be added.
                        Do not include numbers of lines that are blank, already have comments, or are part of a comment.
                        Prefer comment locations in a higher level scope, such as a classes, function definitions and class methods,
                    `).trim() + '\n\n' + limited_view
                }
            ]
        });
        const numbers = message.content.split(',').map(n => Number(n));

        for ( const n of numbers ) {
            if ( Number.isNaN(n) ) {
                console.log('Invalid number:', n);
                continue;
            }
            
            comments.push({
                position: n - 1,
            });
        }
        */

        for ( const def of definitions ) {
            console.log('def?', def);
            let instruction = '';
            
            if ( def.type === 'class' ) {
                instruction = dedent(`
                    Since the comment is going above a class definition, please write a JSDoc style comment.
                    Make the comment as descriptive as possible, including the class name and its purpose.
                `);
            }

            if ( def.type === 'method' ) {
                instruction = dedent(`
                    Since the comment is going above a method, please write a JSDoc style comment.
                    The comment should include a short concise description of the method's purpose,
                    notes about its behavior, and any parameters or return values.
                `);
            }
            
            if ( def.type === 'const' ) {
                instruction = dedent(`
                    Since the comment is going above a constant definition, please write a comment that explains
                    the purpose of the constant and how it is used in the code.
                    The comment should be only one or two lines long, and should use line comments.
                `);
            }
            
            comments.push({
                position: def.line,
                instruction: instruction,
            });
        }
        
        for ( const comment of comments ) {
            // This doesn't work very well yet
            /*
            const ranges_message = await context.ai.complete({
                messages: [
                    {
                        role: 'user',
                        content: dedent(`
                            Please only respond with comma-separated number ranges in this format with no surrounding text:
                            11-21, 25-30, 35-40
                            
                            You may also respond with "none".
                            
                            A comment will be added above line ${comment.position} in the code which follows.
                            You are seeing a limited view of the code that includes chunks around interesting lines.
                            Please specify ranges of lines that might provide useful context for this comment.
                            Do not include in any range lines which are already visible in the limited view.
                            Avoid specifying more than a couple hundred lines.
                        `).trim() + '\n\n' + limited_view
                    }
                ]
            });
            
            if ( ranges_message.content.trim() !== 'none' ) {
                const ranges = ranges_message.content.split(',').map(range => {
                    const [ start, end ] = range.split('-').map(n => Number(n));
                    return { start, end };
                });
                
                for ( const range of ranges ) {
                    key_places.push({
                        anchor: range.start,
                        lines_above: 0,
                        lines_below: range.end - range.start,
                        comment: `Requested range by AI agent: ${range.start}-${range.end}`
                    });
                }
                
                limited_view = create_limited_view(lines, key_places);
                console.log('--- updated view ---');
                console.log(limited_view);
            }
            */

            const message = await context.ai.complete({
                messages: [
                    {
                        role: 'user',
                        content: dedent(`
                            Please write a comment to be added above line ${comment.position}.
                            Do not write any surrounding text; just the comment itself.
                            Please include comment markers. If the comment is on a class, function, or method, please use jsdoc style.
                            The code is written in JavaScript.
                        `).trim() +
                        (comment.instruction ? '\n\n' + dedent(comment.instruction) : '') +
                        '\n\n' + limited_view
                    }
                ]
            });
            console.log('message:', message);
            comment.lines = message.content.split('\n');
            
            // Remove leading and trailing blank lines
            while ( comment.lines.length && ! comment.lines[0].trim() ) {
                comment.lines.shift();
            }
            while ( comment.lines.length && ! comment.lines[comment.lines.length - 1].trim() ) {
                comment.lines.pop();
            }
            
            // Remove leading "```" or "```<language>" lines
            if ( comment.lines[0].startsWith('```') ) {
                comment.lines.shift();
            }
            
            // Remove trailing "```" lines
            if ( comment.lines[comment.lines.length - 1].startsWith('```') ) {
                comment.lines.pop();
            }
            
            comment.lines = dedent(comment.lines.join('\n')).split('\n');
        }

        inject_comments(lines, comments);
        
        console.log('--- lines ---');
        console.log(lines);
        
        lines.unshift('// METADATA // ' + JSON.stringify({
            'ai-commented': true,
        }));
        
        // Write the modified file
        fs.writeFileSync(value.path, lines.join('\n'));
    }

};

main();
