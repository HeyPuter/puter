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
// [reference impl](https://github.com/brgl/busybox/blob/master/shell/ash.c)

const list_ws = [' ', '\n', '\t'];
const list_recorded_tokens = [
    '|', '>', '<', '&', ';', '(', ')',
];
const list_stoptoken = [
    '|', '>', '<', '&', '\\', '#', ';', '(', ')',
    ...list_ws,
];

export const TOKENS = {};
for ( const k of list_recorded_tokens ) {
    TOKENS[k] = {};
}

export const readtoken = str => {
    let state = null;
    let buffer = '';
    let quoteType = '';
    const tokens = [];

    const actions = {
        endToken: () => {
            tokens.push(buffer);
            buffer = '';
        },
    };

    const states = {
        start: i => {
            if ( list_ws.includes(str[i]) ) {
                return;
            }
            if ( str[i] === '#' ) return str.length;
            if ( list_recorded_tokens.includes(str[i]) ) {
                tokens.push(TOKENS[str[i]]);
                return;
            }
            if ( str[i] === '"' || str[i] === "'" ) {
                state = states.quote;
                quoteType = str[i];
                return;
            }
            state = states.text;
            return i; // prevent increment
        },
        text: i => {
            if ( str[i] === '"' || str[i] === "'" ) {
                state = states.quote;
                quoteType = str[i];
                return;
            }
            if ( list_stoptoken.includes(str[i]) ) {
                state = states.start;
                actions.endToken();
                return i; // prevent increment
            }
            buffer += str[i];
        },
        quote: i => {
            if ( str[i] === '\\' ) {
                state = states.quote_esc;
                return;
            }
            if ( str[i] === quoteType ) {
                state = states.text;
                return;
            }
            buffer += str[i];
        },
        quote_esc: i => {
            if ( str[i] !== quoteType ) {
                buffer += '\\';
            }
            buffer += str[i];
            state = states.quote;
        },
    };
    state = states.start;
    for ( let i = 0 ; i < str.length ; ) {
        let newI = state(i);
        i = newI !== undefined ? newI : i + 1;
    }

    if ( buffer !== '' ) actions.endToken();

    return tokens;
};