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
/*
## this source file
- maps: CSI (Control Sequence Introducer) sequences
- to:   expected functionality in the context of readline

## relevant articles
- [ECMA-48](https://www.ecma-international.org/wp-content/uploads/ECMA-48_5th_edition_june_1991.pdf)
- [Wikipedia](https://en.wikipedia.org/wiki/ANSI_escape_code)
*/

import { ANSIContext, getActiveModifiersFromXTerm } from '../ANSIContext.js';
import { findNextWord } from './rl_words.js';

// TODO: potentially include metadata in handlers

// --- util ---
const cc = chr => chr.charCodeAt(0);

const CHAR_DEL = 127;
const CHAR_ESC = 0x1B;

const { consts } = ANSIContext;

// --- convenience function decorators ---
const CSI_INT_ARG = delegate => ctx => {
    const controlSequence = ctx.locals.controlSequence;

    let str = new TextDecoder().decode(controlSequence);

    // Detection of modifier keys like ctrl and shift
    if ( str.includes(';') ) {
        const parts = str.split(';');
        str = parts[0];
        const modsStr = parts[parts.length - 1];
        let modN = Number.parseInt(modsStr);
        const mods = getActiveModifiersFromXTerm(modN);
        for ( const k in mods ) ctx.locals[k] = mods[k];
    }

    let num = str === '' ? 1 : Number.parseInt(str);
    if ( Number.isNaN(num) ) num = 0;

    ctx.locals.num = num;

    return delegate(ctx);
};

// --- PC-Style Function Key handles (see `~` final byte in CSI_HANDLERS) ---
export const PC_FN_HANDLERS = {
    // delete key
    3: ctx => {
        const { vars } = ctx;
        const deleteSequence = new Uint8Array([
            consts.CHAR_ESC, consts.CHAR_CSI, cc('P'),
        ]);
        vars.result = vars.result.slice(0, vars.cursor) +
            vars.result.slice(vars.cursor + 1);
        ctx.externs.out.write(deleteSequence);
    },
};

const save_history = ctx => {
    const { history } = ctx.externs;
    history.save(ctx.vars.result);
};

const correct_cursor = (ctx, oldCursor) => {
    // TODO: make this work differently if oldCursor is not defined

    const amount = ctx.vars.cursor - oldCursor;
    ctx.vars.cursor = ctx.vars.result.length;
    const L = amount < 0 ? 'D' : 'C';
    if ( amount === 0 ) return;
    const moveSequence = new Uint8Array([
        consts.CHAR_ESC, consts.CHAR_CSI,
        ...(new TextEncoder().encode(`${ Math.abs(amount)}`)),
        cc(L),
    ]);
    ctx.externs.out.write(moveSequence);
};

const home = ctx => {
    const amount = ctx.vars.cursor;
    ctx.vars.cursor = 0;
    const moveSequence = new Uint8Array([
        consts.CHAR_ESC, consts.CHAR_CSI,
        ...(new TextEncoder().encode(`${ amount}`)),
        cc('D'),
    ]);
    if ( amount !== 0 ) ctx.externs.out.write(moveSequence);
};

const select_current_history = ctx => {
    const { history } = ctx.externs;
    home(ctx);
    ctx.vars.result = history.get();
    ctx.vars.cursor = ctx.vars.result.length;
    const clearToEndSequence = new Uint8Array([
        consts.CHAR_ESC, consts.CHAR_CSI,
        ...(new TextEncoder().encode('0')),
        cc('K'),
    ]);
    ctx.externs.out.write(clearToEndSequence);
    ctx.externs.out.write(history.get());
};

// --- CSI handlers: this is the last definition in this file ---
export const CSI_HANDLERS = {
    [cc('A')]: CSI_INT_ARG(ctx => {
        save_history(ctx);
        const { history } = ctx.externs;

        if ( history.index === 0 ) return;

        history.index--;
        select_current_history(ctx);
    }),
    [cc('B')]: CSI_INT_ARG(ctx => {
        save_history(ctx);
        const { history } = ctx.externs;

        if ( history.index === history.items.length - 1 ) return;

        history.index++;
        select_current_history(ctx);
    }),
    // cursor back
    [cc('D')]: CSI_INT_ARG(ctx => {
        if ( ctx.vars.cursor === 0 ) {
            return;
        }
        if ( ctx.locals.ctrl ) {
            // TODO: temporary inaccurate implementation
            const txt = ctx.vars.result;
            const ind = findNextWord(txt, ctx.vars.cursor, true);
            const diff = ctx.vars.cursor - ind;
            ctx.vars.cursor = ind;
            const moveSequence = new Uint8Array([
                consts.CHAR_ESC, consts.CHAR_CSI,
                ...(new TextEncoder().encode(`${ diff}`)),
                cc('D'),
            ]);
            ctx.externs.out.write(moveSequence);
            return;
        }
        ctx.vars.cursor -= ctx.locals.num;
        ctx.locals.doWrite = true;
    }),
    // cursor forward
    [cc('C')]: CSI_INT_ARG(ctx => {
        if ( ctx.vars.cursor >= ctx.vars.result.length ) {
            return;
        }
        if ( ctx.locals.ctrl ) {
            // TODO: temporary inaccurate implementation
            const txt = ctx.vars.result;
            const ind = findNextWord(txt, ctx.vars.cursor);
            const diff = ind - ctx.vars.cursor;
            ctx.vars.cursor = ind;
            const moveSequence = new Uint8Array([
                consts.CHAR_ESC, consts.CHAR_CSI,
                ...(new TextEncoder().encode(`${ diff}`)),
                cc('C'),
            ]);
            ctx.externs.out.write(moveSequence);
            return;
        }
        ctx.vars.cursor += ctx.locals.num;
        ctx.locals.doWrite = true;
    }),
    // PC-Style Function Keys
    [cc('~')]: CSI_INT_ARG(ctx => {
        if ( ! PC_FN_HANDLERS.hasOwnProperty(ctx.locals.num) ) {
            console.error(`unrecognized PC Function: ${ctx.locals.num}`);
            return;
        }
        PC_FN_HANDLERS[ctx.locals.num](ctx);
    }),
    // Home
    [cc('H')]: ctx => {
        home(ctx);
    },
    // End
    [cc('F')]: ctx => {
        const amount = ctx.vars.result.length - ctx.vars.cursor;
        ctx.vars.cursor = ctx.vars.result.length;
        const moveSequence = new Uint8Array([
            consts.CHAR_ESC, consts.CHAR_CSI,
            ...(new TextEncoder().encode(`${ amount}`)),
            cc('C'),
        ]);
        if ( amount !== 0 ) ctx.externs.out.write(moveSequence);
    },
};
