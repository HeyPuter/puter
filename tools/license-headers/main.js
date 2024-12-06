// METADATA // {"ai-commented":{"service":"claude"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

const levenshtein = require('js-levenshtein');
const DiffMatchPatch = require('diff-match-patch');
const enq = require('enquirer');
const dmp = new DiffMatchPatch();
const dedent = require('dedent');

const { walk, EXCLUDE_LISTS } = require('file-walker');
const { CommentParser } = require('../comment-parser/main');

const fs = require('fs');
const path_ = require('path');


/**
* Compares two license headers and returns their Levenshtein distance and formatted diff
* @param {Object} params - The parameters object
* @param {string} params.header1 - First header text to compare
* @param {string} params.header2 - Second header text to compare  
* @param {boolean} [params.distance_only=false] - If true, only return distance without diff
* @returns {Object} Object containing distance and formatted terminal diff
*/
const CompareFn = ({ header1, header2, distance_only = false }) => {
    
    // Calculate Levenshtein distance
    const distance = levenshtein(header1, header2);
    // console.log(`Levenshtein distance: ${distance}`);
    
    if ( distance_only ) return { distance };

    // Generate diffs using diff-match-patch
    const diffs = dmp.diff_main(header1, header2);
    dmp.diff_cleanupSemantic(diffs);
    
    let term_diff = '';

    // Manually format diffs for terminal display
    diffs.forEach(([type, text]) => {
        switch (type) {
            case DiffMatchPatch.DIFF_INSERT:
            term_diff += `\x1b[32m${text}\x1b[0m`;  // Green for insertions
            break;
            case DiffMatchPatch.DIFF_DELETE:
            term_diff += `\x1b[31m${text}\x1b[0m`;  // Red for deletions
            break;
            case DiffMatchPatch.DIFF_EQUAL:
            term_diff += text;  // No color for equal parts
            break;
        }
    });
    
    return {
        distance,
        term_diff,
    };
}

/**
* Creates a license checker instance that can compare and validate license headers
* @param {Object} params - Configuration parameters
* @param {Object} params.comment_parser - Comment parser instance to use
* @param {string} params.desired_header - The expected license header text
* @returns {Object} License checker instance with compare and supports methods
*/
const LicenseChecker = ({
    comment_parser,
    desired_header,
}) => {
    const supports = ({ filename }) => {
        return comment_parser.supports({ filename });
    };
    const compare = async ({ filename, source }) => {
        const headers = await comment_parser.extract_top_comments(
            { filename, source });
        const headers_lines = headers.map(h => h.lines);
            
        if ( headers.length < 1 ) {
            return {
                has_header: false,
            };
        }
        
        // console.log('headers', headers);

        let top = 0;
        let bottom = 0;
        let current_distance = Number.MAX_SAFE_INTEGER;
        
        // "wah"
        for ( let i=1 ; i <= headers.length ; i++ ) {
            const combined = headers_lines.slice(top, i).flat();
            const combined_txt = combined.join('\n');
            const { distance } =
                CompareFn({
                    header1: desired_header,
                    header2: combined_txt,
                    distance_only: true,
                });
            if ( distance < current_distance ) {
                current_distance = distance;
                bottom = i;
            } else {
                break;
            }
        }
        // "woop"
        for ( let i=1 ; i < headers.length ; i++ ) {
            const combined = headers_lines.slice(i, bottom).flat();
            const combined_txt = combined.join('\n');
            const { distance } =
                CompareFn({
                    header1: desired_header,
                    header2: combined_txt,
                    distance_only: true,
                });
            if ( distance < current_distance ) {
                current_distance = distance;
                top = i;
            } else {
                break;
            }
        }
        
        // console.log('headers', headers);

        const combined = headers_lines.slice(top, bottom).flat();
        const combined_txt = combined.join('\n');
            
        const diff_info = CompareFn({
            header1: desired_header,
            header2: combined_txt,
        })
        
        if ( diff_info.distance > 0.7*desired_header.length ) {
            return {
                has_header: false,
            };
        }
        
        diff_info.range = [
            headers[top].range[0],
            headers[bottom-1].range[1],
        ];
        
        diff_info.has_header = true;
            
        return diff_info;
    };
    return {
        compare,
        supports,
    };
};

const license_check_test = async ({ options }) => {
    const comment_parser = CommentParser();
    const license_checker = LicenseChecker({
        comment_parser,
        desired_header: fs.readFileSync(
            path_.join(__dirname, '../../doc/license_header.txt'),
            'utf-8',
        ),
    });
    
    const walk_iterator = walk({
        excludes: EXCLUDE_LISTS.NOT_AGPL,
    }, path_.join(__dirname, '../..'));
    for await ( const value of walk_iterator ) {
        if ( value.is_dir ) continue;
        if ( value.name !== 'dev-console-ui-utils.js' ) continue;
        console.log(value.path);
        const source = fs.readFileSync(value.path, 'utf-8');
        const diff_info = await license_checker.compare({
            filename: value.name,
            source,
        })
        if ( diff_info ) {
            process.stdout.write('\x1B[36;1m=======\x1B[0m\n');
            process.stdout.write(diff_info.term_diff);
            process.stdout.write('\n\x1B[36;1m=======\x1B[0m\n');
            // console.log('headers', headers);
        } else {
            console.log('NO COMMENT');
        }
        
        console.log('RANGE', diff_info.range)
        
        const new_comment = comment_parser.output_comment({
            filename: value.name,
            style: 'block',
            text: 'some text\nto display'
        });

        console.log('NEW COMMENT?', new_comment);
    }
};


/**
* Executes the main command line interface for the license header tool.
* Sets up Commander.js program with commands for checking and syncing license headers.
* Handles configuration file loading and command execution.
* 
* @async
* @returns {Promise<void>} Resolves when command execution is complete
*/
const cmd_check_fn = async () => {
    const comment_parser = CommentParser();
    const license_checker = LicenseChecker({
        comment_parser,
        desired_header: fs.readFileSync(
            path_.join(__dirname, '../../doc/license_header.txt'),
            'utf-8',
        ),
    });
    
    const counts = {
        ok: 0,
        missing: 0,
        conflict: 0,
        error: 0,
        unsupported: 0,
    };
    
    const walk_iterator = walk({
        excludes: EXCLUDE_LISTS.NOT_AGPL,
    }, path_.join(__dirname, '../..'));
    for await ( const value of walk_iterator ) {
        if ( value.is_dir ) continue;

        process.stdout.write(value.path + ' ... ');

        if ( ! license_checker.supports({ filename: value.name }) ) {
            process.stdout.write(`\x1B[37;1mUNSUPPORTED\x1B[0m\n`);
            counts.unsupported++;
            continue;
        }

        const source = fs.readFileSync(value.path, 'utf-8');
        const diff_info = await license_checker.compare({
            filename: value.name,
            source,
        })
        if ( ! diff_info ) {
            counts.error++;
            continue;
        }
        if ( ! diff_info.has_header ) {
            counts.missing++;
            process.stdout.write(`\x1B[33;1mMISSING\x1B[0m\n`);
            continue;
        }
        if ( diff_info ) {
            if ( diff_info.distance !== 0 ) {
                counts.conflict++;
                process.stdout.write(`\x1B[31;1mCONFLICT\x1B[0m\n`);
            } else {
                counts.ok++;
                process.stdout.write(`\x1B[32;1mOK\x1B[0m\n`);
            }
        } else {
            console.log('NO COMMENT');
        }
    }
    
    const { Table } = require('console-table-printer');
    const t = new Table({
        columns: [
            {
                title: 'License Header',
                name: 'situation', alignment: 'left', color: 'white_bold' },
            {
                title: 'Number of Files',
                name: 'count', alignment: 'right' },
        ],
        colorMap: {
            green: '\x1B[32;1m',
            yellow: '\x1B[33;1m',
            red: '\x1B[31;1m',
        }
    });
    
    console.log('');
    
    if ( counts.error > 0 ) {
        console.log(`\x1B[31;1mTHERE WERE SOME ERRORS!\x1B[0m`);
        console.log('check the log above for the stack trace');
        console.log('');
        t.addRow({ situation: 'error', count: counts.error },
            { color: 'red' });
    }
    
    console.log(dedent(`
        \x1B[31;1mAny text below is mostly lies!\x1B[0m
        This tool is still being developed and most of what's
        described is "the plan" rather than a thing that will
        actually happen.
        \x1B[31;1m^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\x1B[0m
    `));

    if ( counts.conflict ) {
        console.log(dedent(`
            \x1B[37;1mIt looks like you have some conflicts!\x1B[0m
            Run the following command to update license headers:

               \x1B[36;1maddlicense sync\x1B[0m
               
            This will begin an interactive license update.
            Any time the license doesn't quite match you will
            be given the option to replace it or skip the file.
            \x1B[90mSee \`addlicense help sync\` for other options.\x1B[0m
            
            You will also be able to choose
            "remember for headers matching this one"
            if you know the same issue will come up later.
        `));
    } else if ( counts.missing ) {
        console.log(dedent(`
            \x1B[37;1mSome missing license headers!\x1B[0m
            Run the following command to add the missing license headers:

               \x1B[36;1maddlicense sync\x1B[0m
        `));
    } else {
        console.log(dedent(`
            \x1B[37;1mNo action to perform!\x1B[0m
            Run the following command to do absolutely nothing:

               \x1B[36;1maddlicense sync\x1B[0m
        `));
    }

    console.log('');

    t.addRow({ situation: 'ok', count: counts.ok },
        { color: 'green' });
    t.addRow({ situation: 'missing', count: counts.missing },
        { color: 'yellow' });
    t.addRow({ situation: 'conflict', count: counts.conflict },
        { color: 'red' });
    t.addRow({ situation: 'unsupported', count: counts.unsupported });
    t.printTable();
};


/**
* Synchronizes license headers in source files by adding missing headers and handling conflicts
* 
* Walks through files, checks for license headers, and:
* - Adds headers to files missing them
* - Prompts user to resolve conflicts when headers don't match
* - Handles duplicate headers by allowing removal
* - Tracks counts of different header statuses (ok, missing, conflict, etc)
* 
* @returns {Promise<void>} Resolves when synchronization is complete
*/
const cmd_sync_fn = async () => {
    const comment_parser = CommentParser();
    const desired_header = fs.readFileSync(
        path_.join(__dirname, '../../doc/license_header.txt'),
        'utf-8',
    );
    const license_checker = LicenseChecker({
        comment_parser,
        desired_header,
    });

    const counts = {
        ok: 0,
        missing: 0,
        conflict: 0,
        error: 0,
        unsupported: 0,
    };
    
    const walk_iterator = walk({
        excludes: EXCLUDE_LISTS.NOT_AGPL,
    }, '.');
    for await ( const value of walk_iterator ) {
        if ( value.is_dir ) continue;

        process.stdout.write(value.path + ' ... ');

        if ( ! license_checker.supports({ filename: value.name }) ) {
            process.stdout.write(`\x1B[37;1mUNSUPPORTED\x1B[0m\n`);
            counts.unsupported++;
            continue;
        }

        const source = fs.readFileSync(value.path, 'utf-8');
        const diff_info = await license_checker.compare({
            filename: value.name,
            source,
        })
        if ( ! diff_info ) {
            counts.error++;
            continue;
        }
        if ( ! diff_info.has_header ) {
            fs.writeFileSync(
                value.path,
                comment_parser.output_comment({
                    style: 'block',
                    filename: value.name,
                    text: desired_header,
                }) +
                '\n' +
                source
            );
            continue;
        }
        if ( diff_info ) {
            if ( diff_info.distance !== 0 ) {
                counts.conflict++;
                process.stdout.write(`\x1B[31;1mCONFLICT\x1B[0m\n`);
                process.stdout.write('\x1B[36;1m=======\x1B[0m\n');
                process.stdout.write(diff_info.term_diff);
                process.stdout.write('\n\x1B[36;1m=======\x1B[0m\n');
                const prompt = new enq.Select({
                    message: 'Select Action',
                    choices: [
                        { name: 'skip', message: 'Skip' },
                        { name: 'replace', message: 'Replace' },
                    ]
                })
                const action = await prompt.run();
                if ( action === 'skip' ) continue;
                const before = source.slice(0, diff_info.range[0]);
                const after = source.slice(diff_info.range[1]);
                const new_source = before +
                    comment_parser.output_comment({
                        style: 'block',
                        filename: value.name,
                        text: desired_header,
                    }) +
                    after;
                fs.writeFileSync(value.path, new_source);
            } else {
                let cut_diff_info = diff_info;
                let cut_source = source;
                const cut_header = async () => {
                    cut_source = cut_source.slice(cut_diff_info.range[1]);
                    cut_diff_info = await license_checker.compare({
                        filename: value.name,
                        source: cut_source,
                    });
                };
                await cut_header();
                const cut_range = [
                    diff_info.range[1],
                    diff_info.range[1],
                ];
                const cut_diff_infos = [];
                while ( cut_diff_info.has_header ) {
                    cut_diff_infos.push(cut_diff_info);
                    cut_range[1] += cut_diff_info.range[1];
                    await cut_header();
                }
                if ( cut_range[0] !== cut_range[1] ) {
                    process.stdout.write(`\x1B[31;1mDUPLICATE\x1B[0m\n`);
                    process.stdout.write('\x1B[36;1m==== KEEP ====\x1B[0m\n');
                    process.stdout.write(diff_info.term_diff + '\n');
                    process.stdout.write('\x1B[36;1m==== REMOVE ====\x1B[0m\n');
                    for ( const diff_info of cut_diff_infos ) {
                        process.stdout.write(diff_info.term_diff);
                    }
                    process.stdout.write('\n\x1B[36;1m=======\x1B[0m\n');
                    const prompt = new enq.Select({
                        message: 'Select Action',
                        choices: [
                            { name: 'skip', message: 'Skip' },
                            { name: 'remove', message: 'Remove' },
                        ]
                    })
                    const action = await prompt.run();
                    if ( action === 'skip' ) continue;
                    const new_source =
                        source.slice(0, cut_range[0]) +
                        source.slice(cut_range[1]);
                    fs.writeFileSync(value.path, new_source);
                }
                counts.ok++;
                process.stdout.write(`\x1B[32;1mOK\x1B[0m\n`);
            }
        } else {
            console.log('NO COMMENT');
        }
    }
    
    const { Table } = require('console-table-printer');
    const t = new Table({
        columns: [
            {
                title: 'License Header',
                name: 'situation', alignment: 'left', color: 'white_bold' },
            {
                title: 'Number of Files',
                name: 'count', alignment: 'right' },
        ],
        colorMap: {
            green: '\x1B[32;1m',
            yellow: '\x1B[33;1m',
            red: '\x1B[31;1m',
        }
    });
    
    console.log('');
    
    if ( counts.error > 0 ) {
        console.log(`\x1B[31;1mTHERE WERE SOME ERRORS!\x1B[0m`);
        console.log('check the log above for the stack trace');
        console.log('');
        t.addRow({ situation: 'error', count: counts.error },
            { color: 'red' });
    }
    
    console.log(dedent(`
        \x1B[31;1mAny text below is mostly lies!\x1B[0m
        This tool is still being developed and most of what's
        described is "the plan" rather than a thing that will
        actually happen.
        \x1B[31;1m^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^\x1B[0m
    `));

    if ( counts.conflict ) {
        console.log(dedent(`
            \x1B[37;1mIt looks like you have some conflicts!\x1B[0m
            Run the following command to update license headers:

               \x1B[36;1maddlicense sync\x1B[0m
               
            This will begin an interactive license update.
            Any time the license doesn't quite match you will
            be given the option to replace it or skip the file.
            \x1B[90mSee \`addlicense help sync\` for other options.\x1B[0m
            
            You will also be able to choose
            "remember for headers matching this one"
            if you know the same issue will come up later.
        `));
    } else if ( counts.missing ) {
        console.log(dedent(`
            \x1B[37;1mSome missing license headers!\x1B[0m
            Run the following command to add the missing license headers:

               \x1B[36;1maddlicense sync\x1B[0m
        `));
    } else {
        console.log(dedent(`
            \x1B[37;1mNo action to perform!\x1B[0m
            Run the following command to do absolutely nothing:

               \x1B[36;1maddlicense sync\x1B[0m
        `));
    }

    console.log('');

    t.addRow({ situation: 'ok', count: counts.ok },
        { color: 'green' });
    t.addRow({ situation: 'missing', count: counts.missing },
        { color: 'yellow' });
    t.addRow({ situation: 'conflict', count: counts.conflict },
        { color: 'red' });
    t.addRow({ situation: 'unsupported', count: counts.unsupported });
    t.printTable();
};


/**
* Main entry point for the license header tool.
* Sets up command line interface using Commander and processes commands.
* Handles 'check' and 'sync' commands for managing license headers in files.
* 
* @returns {Promise<void>} Resolves when command processing is complete
*/
const main = async () => {
    const { program } = require('commander');
    const helptext = dedent(`
        Usage: usage text
    `);
    
    const run_command = async ({ cmd, cmd_fn }) => {
        const options = {
            program: program.opts(),
            command: cmd.opts(),
        };
        console.log('options', options);
        
        if ( ! fs.existsSync(options.program.config) ) {
            // TODO: configuration wizard
            fs.writeFileSync(options.program.config, '');
        }
        
        await cmd_fn({ options });
    };
    
    program
        .name('addlicense')
        .option('-c, --config', 'configuration file', 'addlicense.yml')
        .addHelpText('before', helptext)
        ;
    const cmd_check = program.command('check')
        .description('check license headers')
        .option('-n, --non-interactive', 'disable prompting')
        .action(() => {
            run_command({ cmd: cmd_check, cmd_fn: cmd_check_fn });
        })
    const cmd_sync = program.command('sync')
        .description('synchronize files with license header rules')
        .option('-n, --non-interactive', 'disable prompting')
        .action(() => {
            run_command({ cmd: cmd_sync, cmd_fn: cmd_sync_fn })
        })
    program.parse(process.argv);
        
};

if ( require.main === module ) {
    main();
}