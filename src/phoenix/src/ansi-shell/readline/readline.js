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
import { Context } from '../../context/context.js';
import { CommandCompleter } from '../../puter-shell/completers/CommandCompleter.js';
import { FileCompleter } from '../../puter-shell/completers/FileCompleter.js';
import { OptionCompleter } from '../../puter-shell/completers/OptionCompleter.js';
import { Uint8List } from '../../util/bytes.js';
import { StatefulProcessorBuilder } from '../../util/statemachine.js';
import { ANSIContext } from '../ANSIContext.js';
import { readline_comprehend } from './rl_comprehend.js';
import { CSI_HANDLERS } from './rl_csi_handlers.js';
import { HistoryManager } from './history.js';

const decoder = new TextDecoder();

const cc = chr => chr.charCodeAt(0);

const ReadlineProcessorBuilder = builder => builder
    // TODO: import these constants from a package
    .installContext(ANSIContext)
    .installContext(new Context({
        variables: {
            result: { value: '' },
            cursor: { value: 0 },
        },
        // TODO: dormant configuration; waiting on ContextSignature
        imports: {
            out: {},
            in_: {},
            history: {}
        }
    }))
    .variable('result', { getDefaultValue: () => '' })
    .variable('cursor', { getDefaultValue: () => 0 })
    .external('out', { required: true })
    .external('in_', { required: true })
    .external('history', { required: true })
    .external('prompt', { required: true })
    .external('commandCtx', { required: true })
    .beforeAll('get-byte', async ctx => {
        const { locals, externs } = ctx;

        const byteBuffer = new Uint8Array(1);
        await externs.in_.read(byteBuffer);
        locals.byteBuffer = byteBuffer;
        locals.byte = byteBuffer[0];
    })
    .state('start', async ctx => {
        const { consts, vars, externs, locals } = ctx;

        if ( locals.byte === consts.CHAR_LF || locals.byte === consts.CHAR_CR ) {
            externs.out.write('\n');
            ctx.setState('end');
            return;
        }

        if ( locals.byte === consts.CHAR_ETX ) {
            externs.out.write('^C\n');
            // Exit if input line is empty
            // FIXME: Check for 'process' is so we only do this on Node. How should we handle exiting in Puter terminal?
            if ( typeof process !== 'undefined' && ctx.vars.result.length === 0 ) {
                process.exit(1);
                return;
            }
            // Otherwise clear it
            ctx.vars.result = '';
            ctx.setState('end');
            return;
        }

        if ( locals.byte === consts.CHAR_EOT ) {
            externs.out.write('^D\n');
            ctx.vars.result = '';
            ctx.setState('end');
            return;
        }

        if ( locals.byte === consts.CHAR_FF ) {
            externs.out.write('\x1B[H\x1B[2J');
            externs.out.write(externs.prompt);
            externs.out.write(vars.result);
            const invCurPos = vars.result.length - vars.cursor;
            if ( invCurPos !== 0 ) {
                externs.out.write(`\x1B[${invCurPos}D`);
            }
            return;
        }

        if ( locals.byte === consts.CHAR_TAB ) {
            const inputState = readline_comprehend(ctx.sub({
                params: {
                    input: vars.result,
                    cursor: vars.cursor
                }
            }));
            // NEXT: get tab completer for input state
            let completer = null;
            if ( inputState.$ === 'redirect' ) {
                completer = new FileCompleter();
            }

            if ( inputState.$ === 'command' ) {
                if ( inputState.tokens.length === 1 ) {
                    // Match first token against command names
                    completer = new CommandCompleter();
                } else if ( inputState.input.startsWith('--') ) {
                    // Match `--*` against option names, if they exist
                    completer = new OptionCompleter();
                } else {
                    // Match everything else against file names
                    completer = new FileCompleter();
                }
            }

            if ( completer === null ) return;
            
            const completions = await completer.getCompletions(
                externs.commandCtx,
                inputState,
            );
            
            const applyCompletion = txt => {
                const p1 = vars.result.slice(0, vars.cursor);
                const p2 = vars.result.slice(vars.cursor);
                vars.result = p1 + txt + p2;
                vars.cursor += txt.length;
                externs.out.write(txt);
            };

            if ( completions.length === 0 ) return;

            if ( completions.length === 1 ) {
                applyCompletion(completions[0]);
            }

            if ( completions.length > 1 ) {
                let inCommon = '';
                for ( let i=0 ; completions.every(completion => completion.length > i) ; i++ ) {
                    let matches = true;

                    const chrFirst = completions[0][i];
                    for ( let ci=1 ; ci < completions.length ; ci++ ) {
                        const chrOther = completions[ci][i];
                        if ( chrFirst !== chrOther ) {
                            matches = false;
                            break;
                        }
                    }
                
                    if ( ! matches ) break;
                    inCommon += chrFirst;
                }

                if ( inCommon.length > 0 ) {
                    applyCompletion(inCommon);
                }
            }
            return;
        }

        if ( locals.byte === consts.CHAR_ESC ) {
            ctx.setState('ESC');
            return;
        }

        // (note): DEL is actually the backspace key
        // [explained here](https://en.wikipedia.org/wiki/Backspace#Common_use)
        // TOOD: very similar to delete in CSI_HANDLERS; how can this be unified?
        if ( locals.byte === consts.CHAR_DEL ) {
            // can't backspace at beginning of line
            if ( vars.cursor === 0 ) return;

            vars.result = vars.result.slice(0, vars.cursor - 1) +
                vars.result.slice(vars.cursor)

            vars.cursor--;

            // TODO: maybe wrap these CSI codes in a library
            const backspaceSequence = new Uint8Array([
                // consts.CHAR_ESC, consts.CHAR_CSI, cc('s'), // save cur
                consts.CHAR_ESC, consts.CHAR_CSI, cc('D'), // left
                consts.CHAR_ESC, consts.CHAR_CSI, cc('P'),
                // consts.CHAR_ESC, consts.CHAR_CSI, cc('u'), // restore cur
                // consts.CHAR_ESC, consts.CHAR_CSI, cc('D'), // left
            ]);

            externs.out.write(backspaceSequence);
            return;
        }

        const part = decoder.decode(locals.byteBuffer);

        if ( vars.cursor === vars.result.length ) {
            // output
            externs.out.write(locals.byteBuffer);
            // update buffer
            vars.result = vars.result + part;
            // update cursor
            vars.cursor += part.length;
        } else {
            // output
            const insertSequence = new Uint8Array([
                consts.CHAR_ESC,
                consts.CHAR_CSI,
                '@'.charCodeAt(0),
                ...locals.byteBuffer
            ]);
            externs.out.write(insertSequence);
            // update buffer
            vars.result =
                vars.result.slice(0, vars.cursor) +
                part +
                vars.result.slice(vars.cursor)
            // update cursor
            vars.cursor += part.length;
        }
    })
    .onTransitionTo('ESC-CSI', async ctx => {
        ctx.vars.controlSequence = new Uint8List();
    })
    .state('ESC', async ctx => {
        const { consts, vars, externs, locals } = ctx;

        if ( locals.byte === consts.CHAR_ESC ) {
            externs.out.write(consts.CHAR_ESC);
            ctx.setState('start');
            return;
        }

        if ( locals.byte === ctx.consts.CHAR_CSI ) {
            ctx.setState('ESC-CSI');
            return;
        }
        if ( locals.byte === ctx.consts.CHAR_OSC ) {
            ctx.setState('ESC-OSC');
            return;
        }
    })
    .state('ESC-CSI', async ctx => {
        const { consts, locals, vars } = ctx;

        if (
            locals.byte >= consts.CSI_F_0 &&
            locals.byte <  consts.CSI_F_E
        ) {
            ctx.trigger('ESC-CSI.post');
            ctx.setState('start');
            return;
        }

        vars.controlSequence.append(locals.byte);
    })
    .state('ESC-OSC', async ctx => {
        const { consts, locals, vars } = ctx;

        // TODO: ESC\ can also end an OSC sequence according
        //       to sources, but this has not been implemented
        //       because it would add another state.
        //       This should be implemented when there's a
        //       simpler solution ("peek" & "scan" functionality)
        if (
            locals.byte === 0x07
        ) {
            // ctx.trigger('ESC-OSC.post');
            ctx.setState('start');
            return;
        }

        vars.controlSequence.append(locals.byte);
    })
    .action('ESC-CSI.post', async ctx => {
        const { vars, externs, locals } = ctx;

        const finalByte = locals.byte;
        const controlSequence = vars.controlSequence.toArray();

        // Log.log('controlSequence', finalByte, controlSequence);

        if ( ! CSI_HANDLERS.hasOwnProperty(finalByte) ) {
            return;
        }

        ctx.locals.controlSequence = controlSequence;
        ctx.locals.doWrite = false;
        CSI_HANDLERS[finalByte](ctx);

        if ( ctx.locals.doWrite ) {
            externs.out.write(new Uint8Array([
                ctx.consts.CHAR_ESC,
                ctx.consts.CHAR_CSI,
                ...controlSequence,
                finalByte
            ]))
        }
    })
    .build();

const ReadlineProcessor = ReadlineProcessorBuilder(
    new StatefulProcessorBuilder()
);

class Readline {
    constructor (params) {
        this.internal_ = {};
        for ( const k in params ) this.internal_[k] = params[k];

        this.history = new HistoryManager();
    }

    async readline (prompt, commandCtx) {
        const out = this.internal_.out;
        const in_ = this.internal_.in;

        await out.write(prompt);

        const {
            result
        } = await ReadlineProcessor.run({
            prompt,
            out, in_,
            history: this.history,
            commandCtx,
        });

        if ( result.trim() !== '' ) {
            this.history.append(result);
        }

        return result;
    }
}

export default class ReadlineLib {
    static create(params) {
        const rl = new Readline(params);
        return rl;
    }
}
