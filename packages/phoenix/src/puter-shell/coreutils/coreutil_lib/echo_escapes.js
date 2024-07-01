/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
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
/*
    Echo Escapes Implementations
    ----------------------------
    
    This documentation describes how functions in this file
    should be implemented.

    SITUATION
        The function is passed an object called `fns` containing
        functions to interact with the caller.

        It can be assumped that the called has already advanced
        a "text cursor" just past the first character identifying
        the escape sequence. For example, for escape sequence `\a`
        the text cursor will be positioned immediately after `a`.

    INPUTS
        function: peek()
            returns the character at the position of the text cursor

        function: advance(n=1)
            advances the text cursor `n` bytes forward

        function: markIgnored
            informs the caller that the escape sequence should be
            treated as literal text
        
        function: output
            commands the caller to write a string

        function: outputETX
            informs the caller that this is the end of text;
            \c is Ctrl+C is ETX
*/

// TODO: get these values from a common place
const NUL = String.fromCharCode(1);
const BEL = String.fromCharCode(7);
const BS  = String.fromCharCode(8);
const VT  = String.fromCharCode(0x0B);
const FF  = String.fromCharCode(0x0C);
const ESC = String.fromCharCode(0x1B);

const HEX_REGEX = /^[A-Fa-f0-9]/;
const OCT_REGEX = /^[0-7]/;
const maybeGetHex = chr => {
    let hexchars = '';
    if ( chr.match(HEX_REGEX) ) {
        //
    }
};

const echo_escapes = {
    'a': caller => caller.output(BEL),
    'b': caller => caller.output(BS),
    'c': caller => caller.outputETX(),
    'e': caller => caller.output(ESC),
    'f': caller => caller.output(FF),
    'n': caller => caller.output('\n'),
    'r': caller => caller.output('\r'),
    't': caller => caller.output('\t'),
    'v': caller => caller.output(VT),
    'x': caller => {
        let hexchars = '';
        while ( caller.peek().match(HEX_REGEX) ) {
            hexchars += caller.peek();
            caller.advance();

            if ( hexchars.length === 2 ) break;
        }
        if ( hexchars.length === 0 ) {
            caller.markIgnored();
            return;
        }
        caller.output(String.fromCharCode(Number.parseInt(hexchars, 16)));
    },
    '0': caller => {
        let octchars = '';
        while ( caller.peek().match(OCT_REGEX) ) {
            octchars += caller.peek();
            caller.advance();

            if ( octchars.length === 3 ) break;
        }
        if ( octchars.length === 0 ) {
            caller.output(NUL);
            return;
        }
        caller.output(String.fromCharCode(Number.parseInt(octchars, 8)));
    },
    '\\': caller => caller.output('\\'),
};

export const processEscapes = str => {
    let output = '';

    let state = null;
    const states = {};
    states.STATE_ESCAPE = i => {
        state = states.STATE_NORMAL;

        let ignored = false;

        const chr = str[i];
        i++;
        const apiToCaller = {
            advance: n => {
                n = n ?? 1;
                i += n;
            },
            peek: () => str[i],
            output: text => output += text,
            markIgnored: () => ignored = true,
            outputETX: () => {
                state = states.STATE_ETX;
            }
        };
        echo_escapes[chr](apiToCaller);

        if ( ignored ) {
            output += '\\' + str[i];
            return;
        }
        
        return i;
    };
    states.STATE_NORMAL = i => {
        console.log('str@i', str[i]);
        if ( str[i] === '\\' ) {
            console.log('escape state?');
            state = states.STATE_ESCAPE;
            return;
        }
        output += str[i];
    };
    states.STATE_ETX = () => str.length;
    state = states.STATE_NORMAL;

    for ( let i=0 ; i < str.length ; ) {
        i = state(i) ?? i+1;
    }

    return output;
};