// METADATA // {"ai-params":{"service":"claude"},"comment-verbosity": "high","ai-commented":{"service":"claude"}}
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

const models_to_try = [
    {
        service: 'openai-completion',
        model: 'gpt-4o-mini',
    },
    {
        service: 'openai-completion',
        model: 'gpt-4o',
    },
    {
        service: 'claude',
    },
    {
        service: 'xai',
    },
    // llama broke code - that's a "one strike you're out" situation
    // {
    //     service: 'together-ai',
    //     model: 'meta-llama/Meta-Llama-3-70B-Instruct-Turbo',
    // },
    {
        service: 'mistral',
        model: 'mistral-large-latest',
    }
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


/**
* @class AI
* @description A class that handles interactions with the Puter API for AI-powered chat completions.
* This class provides an interface to make requests to the Puter chat completion service,
* handling authentication and message formatting. It supports various AI models through
* the puter-chat-completion driver interface.
*/
class AI {
    constructor (context) {
        //
    }
    

    /**
    * Sends a chat completion request to the Puter API and returns the response message.
    * 
    * @param {Object} params - The parameters for the completion request
    * @param {Array} params.messages - Array of message objects to send to the API
    * @param {Object} params.driver_params - Additional parameters for the driver interface
    * @returns {Promise<Object>} The response message from the API
    * 
    * Makes a POST request to the configured API endpoint with the provided messages and
    * driver parameters. Authenticates using the configured auth token and returns the
    * message content from the response.
    */
    async complete ({ messages, driver_params }) {
        const response = await axi.post(`${context.config.api_url}/drivers/call`, {
            interface: 'puter-chat-completion',
            method: 'complete',
            ...driver_params,
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

const ai_message_to_lines = text => {
    // Extract text content from message object, handling various formats
    while ( typeof text === 'object' ) {
        if ( Array.isArray(text) ) text = text[0];
        else if ( text.content ) text = text.content;
        else if ( text.text ) text = text.text;
        else {
            console.log('Invalid message object', text);
            throw new Error('Invalid message object');
        }
    }
    return text.split('\n');
}

/**
* @class JavascriptFileProcessor
* @description A class responsible for processing JavaScript source files to identify and extract
* various code definitions and structures. It analyzes the file content line by line using
* configurable pattern matchers to detect classes, methods, functions, control structures,
* and constants. The processor maintains context and parameters for consistent processing
* across multiple files.
*/
class JavascriptFileProcessor {
    constructor (context, parameters) {
        this.context = context;
        this.parameters = parameters;
    }
    
    process (lines) {
        const definitions = [];
        // Collect definitions by iterating through each line
        for ( let i = 0 ; i < lines.length ; i++ ) {
            const line = lines[i];
            // Iterate through each line in the file
            for ( const matcher of this.parameters.definition_matchers ) {
                const match = matcher.pattern.exec(line);
                console.log('match object', match);

                // Check if there is a match for any of the definition patterns
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
            name: 'if',
            pattern: /^\s*if\s*\(.*\)\s*{/,
            /**
            * Matches code patterns against a line to identify if it's an if statement
            * @param {string} line - The line of code to check
            * @returns {Object} Returns an object with type: 'if' if pattern matches
            * @description Identifies if statements by matching the pattern /^\s*if\s*\(.*\)\s*{/
            * This handles basic if statement syntax with optional whitespace and any condition
            * within the parentheses
            */
            handler: () => {
                return { type: 'if' };
            }
        },
        {
            name: 'while',
            pattern: /^\s*while\s*\(.*\)\s*{/,
            /**
            * Matches lines that begin with a while loop structure.
            * @param {void} - Takes no parameters
            * @returns {Object} Returns an object with type: 'while' to indicate this is a while loop definition
            * @description Used by the definition matcher system to identify while loop structures in code.
            * The pattern looks for lines that start with optional whitespace, followed by 'while',
            * followed by parentheses containing any characters, and ending with an opening curly brace.
            */
            handler: () => {
                return { type: 'while' };
            }
        },
        {
            name: 'for',
            pattern: /^\s*for\s*\(.*\)\s*{/,
            /**
            * Matches for loop patterns in code and returns a 'for' type definition.
            * Used by the JavascriptFileProcessor to identify for loop structures.
            * @returns {Object} An object with type 'for' indicating a for loop was found
            */
            handler: () => {
                return { type: 'for' };
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
                // Extract method name from match array and handle special cases for 'if' and 'while'
                if ( name === 'if' ) {
                    return { type: 'if' };
                }
                // Check if the name is 'while' and return appropriate type
                if ( name === 'while' ) {
                    return { type: 'while' };
                }
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
                    args: (args ?? '').split(',').map(arg => arg.trim()),
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


/**
* Creates a limited view of the code file by showing specific ranges around key lines.
* Takes an array of lines and key places (anchors with context ranges) and returns
* a formatted string showing relevant code sections with line numbers and descriptions.
* Merges overlapping ranges to avoid duplication.
* @param {string[]} lines - Array of code lines from the file
* @param {Object[]} key_places - Array of objects defining important locations and context
* @returns {string} Formatted string containing the limited code view
*/
const create_limited_view = (lines, key_places) => {
    // Sort key places by starting line
    key_places.sort((a, b) => {
        const a_start = Math.max(0, a.anchor - a.lines_above);
        const b_start = Math.max(0, b.anchor - b.lines_above);
        return a_start - b_start;
    });
    
    const visible_ranges = [];
    
    // Create visible ranges for each key place
    // Create visible ranges for each key place in the limited view
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
    
    // Iterate through each visible range and merge overlapping ones
    for ( const range of visible_ranges ) {
        range.comments = [{
            anchor: range.anchor,
            text: range.comment
        }];

        // If no merged ranges exist yet, add this range as the first one
        if ( ! merged_ranges.length ) {
            merged_ranges.push(range);
            continue;
        }
        
        const last_range = merged_ranges[merged_ranges.length - 1];
        
        // Check if the current range overlaps with the last range in merged_ranges
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
    // Iterate through visible ranges and add line numbers and comments
    for ( let i = 0 ; i < lines.length ; i++ ) {
        const line = lines[i];
        
        let visible_range = null;
        
        if ( i === 22 ) debugger;

        // Iterate through merged ranges to find which range contains the current line
        for ( const range of merged_ranges ) {
            // Check if current line is within any of the merged ranges
            if ( i >= range.start && i < range.end ) {
                visible_range = range;
                break;
            }
        }
        
        // console.log('visible_range', visible_range, i);
        
        // Check if this line is visible in the current range
        if ( visible_range === null ) {
            continue;
        }
        
        // Check if visible range is different from previous range
        if ( visible_range !== previous_visible_range ) {
            if ( i !== 0 ) limited_view += '\n';
            // Check if we're starting a new visible range and add appropriate header
            if ( visible_range.comments.length === 1 ) {
                const comment = visible_range.comments[0];
                limited_view += `window around line ${comment.anchor}: ${comment.text}\n`;
            } else {
                limited_view += `window around lines ${visible_range.comments.length} key lines:\n`;
                // Iterate through visible range comments and add them to the limited view
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
/**
* Injects comments into an array of code lines at specified positions
* @param {string[]} lines - Array of original file lines
* @param {Object[]} comments - Array of comment objects specifying where and what to inject
* @param {number} comments[].position - Line number where comment should be inserted
* @param {string[]} comments[].lines - Array of comment text lines to insert
*/
const inject_comments = (lines, comments) => {
    // Sort comments in reverse order
    comments.sort((a, b) => b.position - a.position);
    
    // Inject comments into lines
    // Inject comments into lines array based on comment objects
    for ( const comment of comments ) {
        // AI might have been stupid and added a comment above a blank line,
        // despite that we told it not to do that. So we need to adjust the position.
        // Adjust comment position if it would be above a blank line
        while ( comment.position < lines.length && ! lines[comment.position].trim() ) {
            comment.position++;
        }
        
        const indentation = lines[comment.position].match(/^\s*/)[0];
        console.log('????', comment.position, lines[comment.position], '|' + indentation + '|');
        const comment_lines = comment.lines.map(line => `${indentation}${line}`);
        lines.splice(comment.position, 0, ...comment_lines);
        
        // If the first line of the comment lines starts with '/*`, ensure there is
        // a blank line above it.
        
        // Check if comment starts with '/*' to ensure proper spacing above JSDoc comments
        if ( comment_lines[0].trim().startsWith('/*') ) {
            // Check if comment starts with JSDoc style to add blank line above
            if ( comment.position > 0 && lines[comment.position - 1].trim() === '' ) {
                lines.splice(comment.position, 0, '');
            }
        }
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


/**
* Creates a new AI instance for handling chat completions
* @param {Object} context - The application context object
* @description Initializes an AI instance that interfaces with the Puter chat completion API.
* The AI instance is used to generate comments and other text responses through the
* chat completion interface.
*/
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
    
    let i = 0;
    for await ( const value of walk_iter ) {
        i++;
        if ( i == 12 ) process.exit(0);
        // Exit after processing 12 files
        if ( value.is_dir ) {
            console.log('directory:', value.path);
            continue;
        }
        // Check if file is not a JavaScript file and skip it
        if ( ! value.name.endsWith('.js') ) {
            continue;
        }
        console.log('file:', value.path);
        const lines = fs.readFileSync(value.path, 'utf8').split('\n');
        
        let metadata, has_metadata_line = false;
        // Check if metadata line exists and parse it
        if ( lines[0].startsWith('// METADATA // ') ) {
            has_metadata_line = true;
            metadata = JSON.parse(lines[0].slice('// METADATA // '.length));
            // Check if metadata exists and has been parsed from the first line
            if ( metadata['ai-commented'] ) {
                console.log('File was already commented by AI; skipping...');
                continue;
            }
        }
        
        let refs = null;
        // Check if there are any references in the metadata
        if ( metadata['ai-refs'] ) {
            const relative_file_paths = metadata['ai-refs'];
            // name of file is the key, value is the contents
            const references = {};
            
            let n  = 0;
            // Iterate through each relative file path in the metadata
            for ( const relative_file_path of relative_file_paths ) {
                n++;
                const full_path = path_.join(path_.dirname(value.path), relative_file_path);
                const ref_text = fs.readFileSync(full_path, 'utf8');
                references[relative_file_path] = ref_text;
            }
            
            // Check if there are any references in the metadata and process them
            if ( n === 1 ) {
                refs = dedent(`
                    The following documentation contains relevant information about the code.
                    The code will follow after this documentation.
                `);
                
                refs += '\n\n' + dedent(references[Object.keys(references)[0]]);
            } else if ( n > 2 ) {
                refs = dedent(`
                    The following documentation contains relevant information about the code.
                    The code will follow after a number of documentation files.
                `);
                
                // Iterate through each key in the references object
                for ( const key of Object.keys(references) ) {
                    refs += '\n\n' + dedent(references[key]);
                }
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
        // const action = 'generate';
        
        // Check if user wants to exit the program
        if ( action.action === 'exit' ) {
            break;
        }
        
        // Skip if user chose to exit
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
        // Iterate through each definition and add comments based on its type
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

        // Iterate through each number in the array of line numbers
        for ( const n of numbers ) {
            // Check if the line number is valid and not NaN before adding comment
            if ( Number.isNaN(n) ) {
                console.log('Invalid number:', n);
                continue;
            }
            
            comments.push({
                position: n - 1,
            });
        }
        */

        // Iterate through each definition to add comments
        for ( const def of definitions ) {
            console.log('def?', def);
            let instruction = '';
            
            // Check if the line starts with an if statement and has curly braces
            if ( def.type === 'class' ) {
                instruction = dedent(`
                    Since the comment is going above a class definition, please write a JSDoc style comment.
                    Make the comment as descriptive as possible, including the class name and its purpose.
                `);
            }

            // Check if comment is for an if/while/for control structure
            if ( def.type === 'if' || def.type === 'while' || def.type === 'for' ) {
                if ( metadata['comment-verbosity'] !== 'high' ) continue;
                instruction = dedent(`
                    Since the comment is going above a control structure, please write a short concise comment.
                    The comment should be only one or two lines long, and should use line comments.
                `);
            }

            // Check if comment is going above a method definition
            if ( def.type === 'method' ) {
                instruction = dedent(`
                    Since the comment is going above a method, please write a JSDoc style comment.
                    The comment should include a short concise description of the method's purpose,
                    notes about its behavior, and any parameters or return values.
                `);
            }
            
            // Check if comment is for a constant definition and set appropriate instruction
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

        const driver_params = metadata['ai-params'] ??
            models_to_try[Math.floor(Math.random() * models_to_try.length)];
        
        // Iterate through each comment object to add comments to the code
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
            
            // Check if the comment lines start with '/*' and ensure there's a blank line above it
            if ( ranges_message.content.trim() !== 'none' ) {
                const ranges = ranges_message.content.split(',').map(range => {
                    const [ start, end ] = range.split('-').map(n => Number(n));
                    return { start, end };
                });
                
                // Iterate through ranges and add key places for each range
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
           
            const prompt =
                dedent(`
                    Please write a comment to be added above line ${comment.position}.
                    Do not write any surrounding text; just the comment itself.
                    Please include comment markers. If the comment is on a class, function, or method, please use jsdoc style.
                    The code is written in JavaScript.
                `).trim() +
                (refs ? '\n\n' + dedent(refs) : '') +
                (comment.instruction ? '\n\n' + dedent(comment.instruction) : '') +
                '\n\n' + limited_view
                ;
           
            // console.log('prompt:', prompt);
           
            const message = await context.ai.complete({
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                driver_params,
            });
            console.log('message:', message);
            comment.lines = ai_message_to_lines(message.content);
            
            // Remove leading and trailing blank lines
            // Remove leading and trailing blank lines from comment lines array
            while ( comment.lines.length && ! comment.lines[0].trim() ) {
                comment.lines.shift();
            }
            // Remove trailing blank lines from comment lines array
            while ( comment.lines.length && ! comment.lines[comment.lines.length - 1].trim() ) {
                comment.lines.pop();
            }
            
            // Remove leading "```" or "```<language>" lines
            // Remove leading "```" or "```<language>" lines
            if ( comment.lines[0].startsWith('```') ) {
                comment.lines.shift();
            }
            
            // Remove trailing "```" lines
            // Remove trailing "```" lines if present
            if ( comment.lines[comment.lines.length - 1].startsWith('```') ) {
                comment.lines.pop();
            }
            
            comment.lines = dedent(comment.lines.join('\n')).split('\n');
        }

        inject_comments(lines, comments);
        
        console.log('--- lines ---');
        console.log(lines);
        
        // Check if file has metadata line and remove it before adding new metadata
        if ( has_metadata_line ) {
            lines.shift();
        }
        
        lines.unshift('// METADATA // ' + JSON.stringify({
            ...metadata,
            'ai-commented': driver_params,
        }));
        
        // Write the modified file
        fs.writeFileSync(value.path, lines.join('\n'));
    }

};

main();
