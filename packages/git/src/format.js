/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Puter's Git client.
 *
 * Puter's Git client is free software: you can redistribute it and/or modify
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
 * @param oid
 * @param short_hashes Whwther to shorten the hash
 * @returns {String}
 */
export const format_oid = (oid, { short_hashes = false } = {}) => {
    // TODO: List refs at this commit, after the hash
    return short_hashes ? shorten_hash(oid) : oid;
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
 * @param commit A CommitObject
 * @param oid Commit hash
 * @param options Options returned by parsing the command arguments in `commit_formatting_options`
 * @returns {string}
 */
export const format_commit = (commit, oid, options = {}) => {
    const title_line = () => commit.message.split('\n')[0];

    switch (options.format || 'medium') {
        // TODO: Other formats
        case 'oneline':
            return `${format_oid(oid, options)} ${title_line()}`;
        case 'short': {
            let s = '';
            s += `commit ${format_oid(oid, options)}\n`;
            s += `Author: ${format_person(commit.author)}\n`;
            s += '\n';
            s += title_line();
            return s;
        }
        case 'medium': {
            let s = '';
            s += `commit ${format_oid(oid, options)}\n`;
            s += `Author: ${format_person(commit.author)}\n`;
            s += `Date:   ${format_date(commit.author)}\n`;
            s += '\n';
            s += commit.message;
            return s;
        }
        case 'full': {
            let s = '';
            s += `commit ${format_oid(oid, options)}\n`;
            s += `Author: ${format_person(commit.author)}\n`;
            s += `Commit: ${format_person(commit.committer)}\n`;
            s += '\n';
            s += commit.message;
            return s;
        }
        case 'fuller': {
            let s = '';
            s += `commit ${format_oid(oid, options)}\n`;
            s += `Author:     ${format_person(commit.author)}\n`;
            s += `AuthorDate: ${format_date(commit.author)}\n`;
            s += `Commit:     ${format_person(commit.committer)}\n`;
            s += `CommitDate: ${format_date(commit.committer)}\n`;
            s += '\n';
            s += commit.message;
            return s;
        }
        case 'raw': {
            let s = '';
            s += `commit ${oid}\n`;
            s += `tree ${commit.tree}\n`;
            if (commit.parent[0])
                s += `parent ${commit.parent[0]}\n`;
            s += `author ${format_person(commit.author)} ${format_timestamp_and_offset(commit.author)}\n`;
            s += `committer ${format_person(commit.committer)} ${format_timestamp_and_offset(commit.committer)}\n`;
            s += '\n';
            s += commit.message;
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
    s += `tree ${oid}\n`;
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
    s += `tag ${tag.tag}\n`;
    s += `Tagger: ${format_person(tag.tagger)}\n`;
    s += `Date:   ${format_date(tag.tagger, options)}\n`;
    if (tag.message) {
        s += `\n${tag.message}\n\n`;
    }
    return s;
}
