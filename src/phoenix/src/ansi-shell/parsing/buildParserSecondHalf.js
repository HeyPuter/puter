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
import { strataparse } from '@heyputer/parsers'
const { ParserBuilder, ParserFactory, StrataParseFacade } = strataparse;

import { PARSE_CONSTANTS } from "./PARSE_CONSTANTS.js";
const escapeSubstitutions = PARSE_CONSTANTS.escapeSubstitutions;

const splitTokens = (items, delimPredicate) => {
    const result = [];
    {
        let buffer = [];
        // single pass to split by pipe token
        for ( let i=0 ; i < items.length ; i++ ) {
            if ( delimPredicate(items[i]) ) {
                result.push(buffer);
                buffer = [];
                continue;
            }

            buffer.push(items[i]);
        }

        if ( buffer.length !== 0 ) {
            result.push(buffer);
        }
    }
    return result;
};

class ReducePrimitivesPStratumImpl {
    next (api) {
        const lexer = api.delegate;

        let { value, done } = lexer.next();

        if ( value.$ === 'string' ) {
            const [lQuote, contents, rQuote] = value.results;
            let text = '';
            for ( const item of contents.results ) {
                if ( item.$ === 'string.segment' ) {
                    text += item.text;
                    continue;
                }
                if ( item.$ === 'string.escape' ) {
                    const [escChar, escValue] = item.results;
                    if ( escValue.$ === 'literal' ) {
                        text += escapeSubstitutions[escValue.text];
                    } // else
                    if ( escValue.$ === 'sequence' ) {
                        // TODO: \u[4],\x[2],\0[3]
                    }
                }
            }

            value.text = text;
            delete value.results;
        }

        return { value, done };
    }
}

class ShellConstructsPStratumImpl {
    static states = [
        {
            name: 'pipeline',
            enter ({ node }) {
                node.$ = 'pipeline';
                node.commands = [];
            },
            exit ({ node }) {
                if ( this.stack_top?.node?.$ === 'script' ) {
                    this.stack_top.node.statements.push(node);
                }
                if ( this.stack_top?.node?.$ === 'string' ) {
                    this.stack_top.node.components.push(node);
                }
            },
            next ({ value, lexer }) {
                if ( value.$ === 'op.line-terminator' ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'op.close' ) {
                    if ( this.stack.length === 1 ) {
                        throw new Error('unexpected close');
                    }
                    lexer.next();
                    this.pop();
                    return;
                }
                if ( value.$ === 'op.pipe' ) {
                    lexer.next();
                }
                this.push('command');
            }
        },
        {
            name: 'command',
            enter ({ node }) {
                node.$ = 'command';
                node.tokens = [];
                node.inputRedirects = [];
                node.outputRedirects = [];
            },
            next ({ value, lexer }) {
                if ( value.$ === 'op.line-terminator' ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'whitespace' ) {
                    lexer.next();
                    return;
                }
                if ( value.$ === 'op.close' ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'op.pipe' ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'op.redirect' ) {
                    this.push('redirect', { direction: value.direction });
                    lexer.next();
                    return;
                }
                this.push('token');
            },
            exit ({ node }) {
                this.stack_top.node.commands.push(node);
            }
        },
        {
            name: 'redirect',
            enter ({ node }) {
                node.$ = 'redirect';
                node.tokens = [];
            },
            exit ({ node }) {
                const { direction } = node;
                const arry = direction === 'in' ?
                    this.stack_top.node.inputRedirects :
                    this.stack_top.node.outputRedirects;
                arry.push(node.tokens[0]);
            },
            next ({ node, value, lexer }) {
                if ( node.tokens.length === 1 ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'whitespace' ) {
                    lexer.next();
                    return;
                }
                if ( value.$ === 'op.close' ) {
                    throw new Error('unexpected close');
                }
                this.push('token');
            }
        },
        {
            name: 'token',
            enter ({ node }) {
                node.$ = 'token';
                node.components = [];
            },
            exit ({ node }) {
                this.stack_top.node.tokens.push(node);
            },
            next ({ value, lexer }) {
                if ( value.$ === 'op.line-terminator' ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'string.dquote' ) {
                    this.push('string', { quote: '"' });
                    lexer.next();
                    return;
                }
                if ( value.$ === 'string.squote' ) {
                    this.push('string', { quote: "'" });
                    lexer.next();
                    return;
                }
                if (
                    value.$ === 'whitespace' ||
                    value.$ === 'op.close'
                ) {
                    this.pop();
                    return;
                }
                this.push('string', { quote: null });
            }
        },
        {
            name: 'string',
            enter ({ node }) {
                node.$ = 'string';
                node.components = [];
            },
            exit ({ node }) {
                this.stack_top.node.components.push(...node.components);
            },
            next ({ node, value, lexer }) {
                if ( value.$ === 'op.line-terminator' && node.quote === null ) {
                    this.pop();
                    return;
                }
                if ( value.$ === 'string.close' && node.quote !== null ) {
                    lexer.next();
                    this.pop();
                    return;
                }
                if (
                    node.quote === null && (
                        value.$ === 'whitespace' ||
                        value.$ === 'op.close'
                    )
                ) {
                        this.pop();
                        return;
                }
                if ( value.$ === 'op.cmd-subst' ) {
                    this.push('pipeline');
                    lexer.next();
                    return;
                }
                node.components.push(value);
                lexer.next();
            }
        },
    ];

    constructor () {
        this.states = this.constructor.states;
        this.buffer = [];
        this.stack = [];
        this.done_ = false;

        this._init();
    }

    _init () {
        this.push('pipeline');
    }

    get stack_top () {
        return this.stack[this.stack.length - 1];
    }

    push (state_name, node) {
        const state = this.states.find(s => s.name === state_name);
        if ( ! node ) node = {};
        this.stack.push({ state, node });
        state.enter && state.enter.call(this, { node });
    }

    pop () {
        const { state, node } = this.stack.pop();
        state.exit && state.exit.call(this, { node });
    }

    chstate (state) {
        this.stack_top.state = state;
    }

    next (api) {
        if ( this.done_ ) return { done: true };

        const lexer = api.delegate;

        // return { done: true, value: { $: 'test' } };

        for ( let i=0 ; i < 500 ; i++ ) {
            const { done, value } = lexer.look();

            if ( done ) {
                while ( this.stack.length > 1 ) {
                    this.pop();
                }
                break;
            }

            const { state, node } = this.stack_top;

            state.next.call(this, { lexer, value, node, state });

            // if ( done ) break;
        }


        this.done_ = true;
        return { done: false, value: this.stack[0].node };
    }

    // old method; not used anymore
    consolidateTokens (tokens) {
        const types = tokens.map(token => token.$);

        if ( tokens.length === 0 ) {
            throw new Error('expected some tokens');
        }

        if ( types.includes('op.pipe') ) {
            const components =
                splitTokens(tokens, t => t.$ === 'op.pipe')
                .map(tokens => this.consolidateTokens(tokens));
            
            return { $: 'pipeline', components };
        }
    
        // const command = tokens.shift();
        const args = [];
        const outputRedirects = [];
        const inputRedirects = [];

        const states = {
            STATE_NORMAL: {},
            STATE_REDIRECT: {
                direction: null
            },
        };
        const stack = [];
        let dest = args;
        let state = states.STATE_NORMAL;
        for ( const token of tokens ) {
            if ( state === states.STATE_REDIRECT ) {
                const arry = state.direction === 'out' ?
                    outputRedirects : inputRedirects;
                arry.push({
                    // TODO: get string value only
                    path: token,
                })
                state = states.STATE_NORMAL;
                continue;
            }
            if ( token.$ === 'op.redirect' ) {
                state = states.STATE_REDIRECT;
                state.direction = token.direction;
                continue;
            }
            if ( token.$ === 'op.cmd-subst' ) {
                const new_dest = [];
                dest = new_dest;
                stack.push({
                    $: 'command-substitution',
                    tokens: new_dest,
                });
                continue;
            }
            if ( token.$ === 'op.close' ) {
                const sub = stack.pop();
                dest = stack.length === 0 ? args : stack[stack.length-1].tokens;
                const cmd_node = this.consolidateTokens(sub.tokens);
                dest.push(cmd_node);
                continue;
            }
            dest.push(token);
        }

        const command = args.shift();

        return {
            $: 'command',
            command,
            args,
            inputRedirects,
            outputRedirects,
        };
    }
}

class MultilinePStratumImpl extends ShellConstructsPStratumImpl {
    static states = [
        {
            name: 'script',
            enter ({ node }) {
                node.$ = 'script';
                node.statements = [];
            },
            next ({ value, lexer }) {
                if ( value.$ === 'op.line-terminator' ) {
                    lexer.next();
                    return;
                }

                this.push('pipeline');
            }
        },
        ...ShellConstructsPStratumImpl.states,
    ];

    _init () {
        this.push('script');
    }
}

export const buildParserSecondHalf = (sp, { multiline } = {}) => {
    const parserFactory = new ParserFactory();
    const parserRegistry = StrataParseFacade.getDefaultParserRegistry();

    const parserBuilder = new ParserBuilder(
        parserFactory,
        parserRegistry,
    );

    // sp.add(new ReducePrimitivesPStratumImpl());
    if ( multiline ) {
        sp.add(new MultilinePStratumImpl());
    } else {
        sp.add(new ShellConstructsPStratumImpl());
    }
}