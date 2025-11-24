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
import { Context } from '../context/context.js';

const modifiers = ['shift', 'alt', 'ctrl', 'meta'];

const keyboardModifierBits = {};
for ( let i = 0 ; i < modifiers.length ; i++ ) {
    const key = `KEYBOARD_BIT_${modifiers[i].toUpperCase()}`;
    keyboardModifierBits[key] = 1 << i;
}

export const ANSIContext = new Context({
    constants: {
        CHAR_LF: '\n'.charCodeAt(0),
        CHAR_CR: '\r'.charCodeAt(0),
        CHAR_TAB: '\t'.charCodeAt(0),
        CHAR_CSI: '['.charCodeAt(0),
        CHAR_OSC: ']'.charCodeAt(0),
        CHAR_ETX: 0x03,
        CHAR_EOT: 0x04,
        CHAR_ESC: 0x1B,
        CHAR_DEL: 0x7F,
        CHAR_BEL: 0x07,
        CHAR_FF: 0x0C,
        CSI_F_0: 0x40,
        CSI_F_E: 0x7F,
        ...keyboardModifierBits,
    },
});

export const getActiveModifiersFromXTerm = (n) => {
    // decrement explained in doc/graveyard/keyboard_modifiers.md
    n--;

    const active = {};

    for ( let i = 0 ; i < modifiers.length ; i++ ) {
        if ( n & 1 << i ) {
            active[modifiers[i]] = true;
        }
    }

    return active;
};
