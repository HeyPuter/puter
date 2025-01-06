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
const { quot, osclink } = require('@heyputer/putility').libs.string;

const reused = {
    runtime_env_references: [
        {
            subject: 'ENVIRONMENT.md file',
            location: 'root of the repository',
            use: 'describes which paths are checked',
        },
        {
            subject: 'boot logger',
            location: 'above this text',
            use: 'shows what checks were performed',
        },
        {
            subject: 'RuntimeEnvironment.js',
            location: 'src/boot/ in repository',
            use: 'code that performs the checks',
        }
    ]
};

const programmer_errors = [
    'Assignment to constant variable.'
];

const error_help_details = [
    {
        match: ({ message }) => (
            message.startsWith('No suitable path found for')
        ),
        apply (more) {
            more.references = [
                ...reused.runtime_env_references,
            ];
        }
    },
    {
        match: ({ message }) => (
            message.match(/^No (read|write) permission for/)
        ),
        apply (more) {
            more.solutions = [
                {
                    title: 'Change permissions with chmod',
                },
                {
                    title: 'Remove the path to use working directory',
                },
                {
                    title: 'Set CONFIG_PATH or RUNTIME_PATH environment variable',
                },
            ];
            more.references = [
                ...reused.runtime_env_references,
            ];
        }
    },
    {
        match: ({ message }) => (
            message.startsWith('No valid config file found in path')
        ),
        apply (more) {
            more.solutions = [
                {
                    title: 'Create a valid config file',
                },
            ];
        }
    },
    {
        match: ({ message }) => (
            message === `config_name is required`
        ),
        apply (more) {
            more.solutions = [
                'ensure config_name is present in your config file',
                'Seek help on ' + osclink(
                    'https://discord.gg/PQcx7Teh8u',
                    'our Discord server'
                ),
            ];
        }
    },
    {
        match: ({ message }) => (
            message == 'Assignment to constant variable.'
        ),
        apply (more) {
            more.references = [
                {
                    subject: 'MDN Reference for this error',
                    location: 'on the internet',
                    use: 'describes why this error occurs',
                    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Invalid_const_assignment'
                },
            ];
        }
    },
    {
        match: ({ message }) => (
            programmer_errors.includes(message)
        ),
        apply (more) {
            more.notes = [
                'It looks like this might be our fault.',
            ];
            more.solutions = [
                {
                    title: `Check for an issue on ` +
                        osclink('https://github.com/HeyPuter/puter/issues')
                },
                {
                    title: `If there's no issue, please ` +
                        osclink(
                            'https://github.com/HeyPuter/puter/issues/new',
                            'create one'
                        ) + '.'
                }
            ];
        }
    },
    {
        match: ({ message }) => (
            message.startsWith('Expected double-quoted property')
        ),
        apply (more) {
            more.notes = [
                'There might be a trailing-comma in your config',
            ];
        }
    }
];

/**
 * Print error help information to a stream in a human-readable format.
 *
 * @param {Error} err - The error to print help for.
 * @param {*} out - The stream to print to; defaults to process.stdout.
 * @returns {undefined}
 */
const print_error_help = (err, out = process.stdout) => {
    if ( ! err.more ) {
        err.more = {};
        err.more.references = [];
        err.more.solutions = [];
        for ( const detail of error_help_details ) {
            if ( detail.match(err) ) {
                detail.apply(err.more);
            }
        }
    }

    let write = out.write.bind(out);

    write('\n');

    const wrap_msg = s =>
        `\x1B[31;1m┏━━ [ HELP:\x1B[0m ${quot(s)} \x1B[31;1m]\x1B[0m`;
    const wrap_list_title = s =>
        `\x1B[36;1m${s}:\x1B[0m`;

    write(wrap_msg(err.message) + '\n');

    write = (s) => out.write('\x1B[31;1m┃\x1B[0m ' + s);

    const vis = (stok, etok, str) => {
        return `\x1B[36;1m${stok}\x1B[0m${str}\x1B[36;1m${etok}\x1B[0m`;
    }

    let lf_sep = false;

    write('Whoops! Looks like something isn\'t working!\n');
    let any_help = false;

    if ( err.more.notes ) {
        write('\n');
        lf_sep = true;
        any_help = true;
        for ( const note of err.more.notes ) {
            write(`\x1B[33;1m * ${note}\x1B[0m\n`);
        }
    }

    if ( err.more.solutions?.length > 0 ) {
        if ( lf_sep ) write('\n');
        lf_sep = true;
        any_help = true;
        write('The suggestions below may help resolve this issue.\n')
        write('\n');
        write(wrap_list_title('Possible Solutions') + '\n');
        for ( const sol of err.more.solutions ) {
            write(`  - ${sol.title}\n`);
        }
    }

    if ( err.more.references?.length > 0 ) {
        if ( lf_sep ) write('\n');
        lf_sep = true;
        any_help = true;
        write('The references below may be related to this issue.\n')
        write('\n');
        write(wrap_list_title('References') + '\n');
        for ( const ref of err.more.references ) {
            write(`  - ${vis('[', ']', ref.subject)} ` +
                `${vis('(', ')', ref.location)};\n`);
            write(`      ${ref.use}\n`);
            if ( ref.url ) {
                write(`      ${osclink(ref.url)}\n`);
            }
        }
    }

    if ( ! any_help ) {
        write('No help is available for this error.\n');
        write('Help can be added in src/errors/error_help_details.\n');
    }

    out.write(`\x1B[31;1m┗━━ [ END HELP ]\x1B[0m\n`)
    out.write('\n');
}

module.exports = {
    error_help_details,
    print_error_help,
};
