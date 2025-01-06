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

const { AdvancedBase } = require("../..");

class Invoker extends AdvancedBase {
    static create ({
        decorators,
        delegate,
    }) {
        const invoker = new Invoker();
        invoker.decorators = decorators;
        invoker.delegate = delegate;
        return invoker;
    }
    async run (args) {
        let fn = this.delegate;
        const decorators = this.decorators;
        for ( let i = decorators.length-1 ; i >= 0 ; i-- ) {
            const dec = decorators[i];
            fn = this.add_dec_(dec, fn);
        }
        return await fn(args);
    }
    add_dec_ (dec, fn) {
        return async (args) => {
            try {
                if ( dec.on_call ) {
                    args = await dec.on_call(args);
                }
                let result = await fn(args);
                if ( dec.on_return ) {
                    result = await dec.on_return(result);
                }
                return result;
            } catch (e) {
                if ( ! dec.on_error ) throw e;

                let cancel = false;
                const a = {
                    error () { return e },
                    cancel_error () { cancel = true; },
                };
                const result = await dec.on_error(a);
                if ( cancel ) {
                    return result;
                }
                throw result ?? e;
            }
        }
    }
}

module.exports = {
    Invoker,
};
