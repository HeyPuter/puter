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
import { disallowAccessToUndefined } from "./lang.js";
import putility from '@heyputer/putility';
const { Context } = putility.libs.context;

export class StatefulProcessor {
    constructor (params) {
        for ( const k in params ) this[k] = params[k];

        let lastState = null;
    }
    async run (imports) {
        this.state = 'start';
        imports = imports ?? {};
        const externals = {};
        for ( const k in this.externals ) {
            if ( this.externals[k].required && ! imports[k] ) {
                throw new Error(`missing required external: ${k}`);
            }
            if ( ! imports[k] ) continue;
            externals[k] = imports[k];
        }

        const ctx = new Context({
            consts: disallowAccessToUndefined(this.constants),
            externs: externals,
            vars: this.createVariables_(),
            setState: this.setState_.bind(this)
        });

        for ( ;; ) {
            if ( this.state === 'end' ) break;

            await this.iter_(ctx);
        }

        return ctx.vars;
    }
    setState_ (newState) {
        this.state = newState;
    }
    async iter_ (runContext) {
        const ctx = runContext.sub({
            locals: {}
        });

        ctx.trigger = name => {
            return this.actions[name](ctx);
        }
        if ( this.state !== this.lastState ) {
            this.lastState = this.state;
            if ( this.transitions.hasOwnProperty(this.state) ) {
                for ( const handler of this.transitions[this.state] ) {
                    await handler(ctx);
                }
            }
        }
        
        for ( const beforeAll of this.beforeAlls ) {
            await beforeAll.handler(ctx);
        }

        await this.states[this.state](ctx);
    }
    createVariables_ () {
        const o = {};
        for ( const k in this.variables ) {
            if ( this.variables[k].getDefaultValue ) {
                o[k] = this.variables[k].getDefaultValue();
            }
        }
        return o;
    }
}

export class StatefulProcessorBuilder {
    static COMMON_1 = [
        'variable', 'external', 'state', 'action'
    ]

    constructor () {
        this.constants = {};
        this.beforeAlls = [];
        this.transitions = {};

        for ( const facet of this.constructor.COMMON_1 ) {
            this[facet + 's'] = {};
            this[facet] = function (name, value) {
                this[facet + 's'][name] = value;
                return this;
            }
        }
    }

    installContext (context) {
        for ( const k in context.constants ) {
            this.constant(k, context.constants[k]);
        }
        return this;
    }

    constant (name, value) {
        Object.defineProperty(this.constants, name, {
            value
        });
        return this;
    }

    beforeAll (name, handler) {
        this.beforeAlls.push({
            name, handler
        });
        return this;
    }

    onTransitionTo (name, handler) {
        if ( ! this.transitions.hasOwnProperty(name) ) {
            this.transitions[name] = [];
        }
        this.transitions[name].push(handler);
        return this;
    }

    build () {
        const params = {};
        for ( const facet of this.constructor.COMMON_1 ) {
            params[facet + 's'] = this[facet + 's'];
        }
        return new StatefulProcessor({
            ...params,
            constants: this.constants,
            beforeAlls: this.beforeAlls,
            transitions: this.transitions,
        });
    }
}