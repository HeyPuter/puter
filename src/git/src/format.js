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
import { shorten_hash } from './git-helpers.js';
import chalk from 'chalk';
import { get_matching_refs } from './refs.js';

export const commit_formatting_options = {
    'abbrev-commit': {
        description: 'Display commit hashes in abbreviated form.',
        type: 'boolean',
    },
    'no-abbrev-commit': {
        description: 'Always show full commit hashes.',
        type: 'boolean',
    },
    'format': {
        description: 'Format to use for commits.',
        type: 'string',
    },
    'oneline': {
        description: 'Shorthand for "--format=oneline --abbrev-commit".',
        type: 'boolean',
    },
};

/**
 * Process command-line options related to commit formatting, and modify them in place.
 * May throw if the options are in some way invalid.
 * @param options Parsed command-line options, which will be modified in place.
 */
export const process_commit_formatting_options = (options) => {
    if (options.oneline) {
        options.format = 'oneline';
        options['abbrev-commit'] = true;
    }

    options.short_hashes = (options['abbrev-commit'] === true) && (options['no-abbrev-commit'] !== true);
    delete options['abbrev-commit'];
    delete options['no-abbrev-commit'];

    if (!options.format) {
        options.format = 'medium';
    }
    if (!['oneline', 'short', 'medium', 'full', 'fuller', 'raw'].includes(options.format)) {
        throw new Error(`Invalid --format format: ${options.format}`);
    }
}

/**
 * Format the given oid hash, followed by any refs that point to it
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @param oid
 * @param short_hashes Whwther to shorten the hash
 * @returns {String}
 */
export const format_commit_oid = async (git_context, oid, { short_hashes = false } = {}) => {
    const hash = short_hashes ? await shorten_hash(git_context, oid) : oid;

    const refs = await get_matching_refs(git_context, oid);
    if (refs.length === 0)
        return hash;

    let s = `${hash} (`;
    s += refs.map(ref => {
        // Different kinds of ref are styled differently, but all are in bold:
        // HEAD and local branches are cyan
        if (ref === 'HEAD') {
            // TODO: If HEAD points to another ref, that should be shown here as `HEAD -> other`
            return chalk.bold.cyan(ref);
        }
        if (ref.startsWith('refs/heads/'))
            return chalk.bold.cyanBright(ref.slice('refs/heads/'.length));
        // Tags are `tag: foo` in yellow
        if (ref.startsWith('refs/tags/'))
            return chalk.bold.yellowBright(`tag: ${ref.slice('refs/tags/'.length)}`);
        // Remote branches are red
        if (ref.startsWith('refs/remotes/'))
            return chalk.bold.red(ref.slice('refs/remotes/'.length));
        // Assuming there's anything else, we'll just bold it.
        return chalk.bold(ref);
    }).join(', ');
    s += ')';

    return s;
}

/**
 * Format the person's name and email as `${name} <${email}>`
 * @param person
 * @returns {`${string} <${string}>`}
 */
export const format_person = (person) => {
    return `${person.name} <${person.email}>`;
}

/**
 * Format a date
 * @param date
 * @param options
 * @returns {string}
 */
export const format_date = (date, options = {}) => {
    // TODO: This needs to obey date-format options, and should show the correct timezone not UTC
    return new Date(date.timestamp * 1000).toUTCString();
}

/**
 * Format the date, according to the "raw" display format.
 * @param owner
 * @returns {`${string} ${string}${string}${string}`}
 */
export const format_timestamp_and_offset = (owner) => {
    // FIXME: The timezone offset is inverted.
    //        Either this is correct here, or we should be inverting it when creating the commit -
    //        Isomorphic git uses (new Date()).timezoneOffset() there, which returns -60 for BST, which is UTC+0100
    const offset = -owner.timezoneOffset;
    const offset_hours = Math.floor(offset / 60);
    const offset_minutes = offset % 60;
    const pad = (number) => `${Math.abs(number) < 10 ? '0' : ''}${Math.abs(number)}`;
    return `${owner.timestamp} ${offset < 0 ? '-' : '+'}${pad(offset_hours)}${pad(offset_minutes)}`;
}

/**
 * Produce a string representation of a commit.
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @param commit A CommitObject
 * @param oid Commit hash
 * @param options Options returned by parsing the command arguments in `commit_formatting_options`
 * @returns {string}
 */
export const format_commit = async (git_context, commit, oid, options = {}) => {
    const title_line = () => commit.message.split('\n')[0];
    const indent = (text) => text.split('\n').map(it => `    ${it}`).join('\n');

    switch (options.format || 'medium') {
        // TODO: Other formats
        case 'oneline':
            return `${chalk.yellow(await format_commit_oid(git_context, oid, options))} ${title_line()}`;
        case 'short': {
            let s = '';
            s += chalk.yellow(`commit ${await format_commit_oid(git_context, oid, options)}\n`);
            s += `Author: ${format_person(commit.author)}\n`;
            s += '\n';
            s += indent(title_line());
            return s;
        }
        case 'medium': {
            let s = '';
            s += chalk.yellow(`commit ${await format_commit_oid(git_context, oid, options)}\n`);
            s += `Author: ${format_person(commit.author)}\n`;
            s += `Date:   ${format_date(commit.author)}\n`;
            s += '\n';
            s += indent(commit.message);
            return s;
        }
        case 'full': {
            let s = '';
            s += chalk.yellow(`commit ${await format_commit_oid(git_context, oid, options)}\n`);
            s += `Author: ${format_person(commit.author)}\n`;
            s += `Commit: ${format_person(commit.committer)}\n`;
            s += '\n';
            s += indent(commit.message);
            return s;
        }
        case 'fuller': {
            let s = '';
            s += chalk.yellow(`commit ${await format_commit_oid(git_context, oid, options)}\n`);
            s += `Author:     ${format_person(commit.author)}\n`;
            s += `AuthorDate: ${format_date(commit.author)}\n`;
            s += `Commit:     ${format_person(commit.committer)}\n`;
            s += `CommitDate: ${format_date(commit.committer)}\n`;
            s += '\n';
            s += indent(commit.message);
            return s;
        }
        case 'raw': {
            let s = '';
            s += chalk.yellow(`commit ${await format_commit_oid(git_context, oid, options)}\n`);
            s += `tree ${commit.tree}\n`;
            if (commit.parent[0])
                s += `parent ${commit.parent[0]}\n`;
            s += `author ${format_person(commit.author)} ${format_timestamp_and_offset(commit.author)}\n`;
            s += `committer ${format_person(commit.committer)} ${format_timestamp_and_offset(commit.committer)}\n`;
            s += '\n';
            s += indent(commit.message);
            return s;
        }
        default: {
            throw new Error(`Invalid --format format: ${options.format}`);
        }
    }
}

/**
 * Produce a string representation of a tree.
 * @param oid
 * @param tree
 * @param options
 * @returns {string}
 */
export const format_tree = (oid, tree, options = {}) => {
    let s = '';
    s += chalk.yellow(`tree ${oid}\n`);
    s += '\n';
    for (const tree_entry of tree) {
        s += `${tree_entry.path}\n`;
    }
    s += '\n';
    return s;
}

/**
 * Produce a string representation of a tag.
 * Note that this only includes the tag itself, and not the tag's target,
 * which must be separately retrieved and formatted.
 * @param tag
 * @param options
 * @returns {string}
 */
export const format_tag = (tag, options = {}) => {
    let s = '';
    s += chalk.yellow(`tag ${tag.tag}\n`);
    s += `Tagger: ${format_person(tag.tagger)}\n`;
    s += `Date:   ${format_date(tag.tagger, options)}\n`;
    if (tag.message) {
        s += `\n${tag.message}\n\n`;
    }
    return s;
}

export const diff_formatting_options = {
    'patch': {
        description: 'Generate a patch.',
        type: 'boolean',
        short: 'p',
    },
    'no-patch': {
        description: 'Suppress patch output. Useful for commands that output a patch by default.',
        type: 'boolean',
        short: 's',
    },
    'raw': {
        description: 'Generate diff in raw format.',
        type: 'boolean',
    },
    'patch-with-raw': {
        description: 'Alias for --patch --raw.',
        type: 'boolean',
    },
    'numstat': {
        description: 'Generate a diffstat in a machine-friendly format.',
        type: 'boolean',
    },
    'summary': {
        description: 'List newly added, deleted, or moved files.',
        type: 'boolean',
    },
    'unified': {
        description: 'Generate patches with N lines of context. Implies --patch.',
        type: 'string',
        short: 'U',
    },
    'src-prefix': {
        description: 'Show the given source prefix instead of "a/".',
        type: 'string',
    },
    'dst-prefix': {
        description: 'Show the given destination prefix instead of "b/".',
        type: 'string',
    },
    'no-prefix': {
        description: 'Do not show source or destination prefixes.',
        type: 'boolean',
    },
    'default-prefix': {
        description: 'Use default "a/" and "b/" source and destination prefixes.',
        type: 'boolean',
    },
};

/**
 * Process command-line options related to diff formatting, and return an options object to pass to format_diff().
 * @param options Parsed command-line options.
 * @returns {{raw: boolean, numstat: boolean, summary: boolean, patch: boolean, context_lines: number, no_patch: boolean, source_prefix: string, dest_prefix: string }}
 */
export const process_diff_formatting_options = (options, { show_patch_by_default = true } = {}) => {
    const result = {
        raw: false,
        numstat: false,
        summary: false,
        patch: false,
        context_lines: 3,
        no_patch: false,
        source_prefix: 'a/',
        dest_prefix: 'b/',
    };

    result.display_diff = () => {
        return !result.no_patch && (result.raw || result.numstat || result.summary || result.patch);
    };

    if (options['raw'])
        result.raw = true;
    if (options['numstat'])
        result.numstat = true;
    if (options['summary'])
        result.summary = true;
    if (options['patch'])
        result.patch = true;
    if (options['patch-with-raw']) {
        result.patch = true;
        result.raw = true;
    }
    if (options['unified'] !== undefined) {
        result.patch = true;
        result.context_lines = options['unified'];
    }
    
    // Prefixes
    if (options['src-prefix'])
        result.source_prefix = options['src-prefix'];
    if (options['dst-prefix'])
        result.dest_prefix = options['dst-prefix'];
    if (options['default-prefix']) {
        result.source_prefix = 'a/';
        result.dest_prefix = 'b/';
    }
    if (options['no-prefix']) {
        result.source_prefix = '';
        result.dest_prefix = '';
    }

    // If nothing is specified, default to --patch
    if (show_patch_by_default && !result.raw && !result.numstat && !result.summary && !result.patch)
        result.patch = true;

    // --no-patch overrides the others
    if (options['no-patch'])
        result.no_patch = true;

    return result;
}

/**
 * Produce a string representation of the given diffs.
 * @param git_context {{ fs, dir, gitdir, cache }} as taken by most isomorphic-git methods.
 * @param diffs A single object, or array of them, in the format:
 *     {
 *         a: { mode, oid },
 *         b: { mode, oid },
 *         diff: object returned by Diff.structuredPatch() - see https://www.npmjs.com/package/diff
 *     }
 * @param options Object returned by process_diff_formatting_options()
 * @returns {string}
 */
export const format_diffs = async (git_context, diffs, options) => {
    if (!(diffs instanceof Array))
        diffs = [diffs];

    let s = '';
    if (options.raw) {
        // https://git-scm.com/docs/diff-format#_raw_output_format
        for (const { a, b, diff } of diffs) {
            const short_a_oid = await shorten_hash(git_context, a.oid);
            const short_b_oid = await shorten_hash(git_context, b.oid);

            s += `:${a.mode} ${b.mode} ${short_a_oid} ${short_b_oid} `;
            // Status. For now, we just support A/D/M
            if (a.mode === '000000') {
                s += 'A'; // Added
            } else if (b.mode === '000000') {
                s += 'D'; // Deleted
            } else {
                s += 'M'; // Modified
            }
            // TODO: -z option
            s += `\t${diff.oldFileName}\n`;
        }
        s += '\n';
    }

    if (options.numstat) {
        // https://git-scm.com/docs/diff-format#_other_diff_formats
        for (const { a, b, diff } of diffs) {
            const { added_lines, deleted_lines } = diff.hunks.reduce((acc, hunk) => {
                const first_char_counts = hunk.lines.reduce((acc, line) => {
                    acc[line[0]] = (acc[line[0]] || 0) + 1;
                    return acc;
                }, {});
                acc.added_lines += first_char_counts['+'] || 0;
                acc.deleted_lines += first_char_counts['-'] || 0;
                return acc;
            }, { added_lines: 0, deleted_lines: 0 });

            // TODO: -z option
            s += `${added_lines}\t${deleted_lines}\t`;
            if (diff.oldFileName === diff.newFileName) {
                s += `${diff.oldFileName}\n`;
            } else {
                s += `${diff.oldFileName} => ${diff.newFileName}\n`;
            }
        }
    }

    // TODO: --stat / --compact-summary

    if (options.summary) {
        // https://git-scm.com/docs/diff-format#_other_diff_formats
        for (const { a, b, diff } of diffs) {
            if (diff.oldFileName === diff.newFileName)
                continue;

            if (diff.oldFileName === '/dev/null') {
                s += `create mode ${b.mode} ${diff.newFileName}\n`;
            } else if (diff.newFileName === '/dev/null') {
                s += `delete mode ${a.mode} ${diff.oldFileName}\n`;
            } else {
                // TODO: Abbreviate shared parts of path - see git manual link above.
                s += `rename ${diff.oldFileName} => ${diff.newFileName}\n`;
            }
        }
    }

    if (options.patch) {
        for (const { a, b, diff } of diffs) {
            const a_path = diff.oldFileName.startsWith('/') ? diff.oldFileName : `${options.source_prefix}${diff.oldFileName}`;
            const b_path = diff.newFileName.startsWith('/') ? diff.newFileName : `${options.dest_prefix}${diff.newFileName}`;

            const short_a_oid = await shorten_hash(git_context, a.oid);
            const short_b_oid = await shorten_hash(git_context, b.oid);

            // NOTE: This first line shows `a/$newFileName` for files that are new, not `/dev/null`.
            const first_line_a_path = a_path !== '/dev/null' ? a_path : `${options.source_prefix}${diff.newFileName}`;
            s += chalk.bold(`diff --git ${first_line_a_path} ${b_path}\n`);
            if (a.mode === b.mode) {
                s += chalk.bold(`index ${short_a_oid}..${short_b_oid} ${a.mode}\n`);
            } else {
                if (a.mode === '000000') {
                    s += chalk.bold(`new file mode ${b.mode}\n`);
                } else {
                    s += chalk.bold(`old mode ${a.mode}\n`);
                    s += chalk.bold(`new mode ${b.mode}\n`);
                }
                s += chalk.bold(`index ${short_a_oid}..${short_b_oid}\n`);
            }
            if (!diff.hunks.length)
                continue;

            s += chalk.bold(`--- ${a_path}\n`);
            s += chalk.bold(`+++ ${b_path}\n`);

            for (const hunk of diff.hunks) {
                s += chalk.blueBright(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`);

                for (const line of hunk.lines) {
                    switch (line[0]) {
                        case '+':
                            s += chalk.greenBright(`${line}\n`);
                            break;
                        case '-':
                            s += chalk.redBright(`${line}\n`);
                            break;
                        default:
                            s += `${line}\n`;
                            break;
                    }
                }
            }
        }
    }


    return s;
}
