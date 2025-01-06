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
class CodeUtil {
    /**
     * Wrap a method*[1] with an implementation of a runnable class.
     * The wrapper must be a class that implements `async run(values)`,
     * and `run` should delegate to `this._run()` after setting this.values.
     * The `BaseOperation` class is an example of such a class.
     *
     * [1]: since our runnable interface expects named parameters, this
     *      wrapping behavior is only useful for methods that accept a single
     *      object argument.
     * @param {*} method
     * @param {*} wrapper
     */
    static mrwrap (method, wrapper, options = {}) {
        const cls_name = options.name || method.name;

        const cls = class extends wrapper {
            async _run () {
                return await method.call(this.self, this.values);
            }
        }

        Object.defineProperty(cls, 'name', { value: cls_name });

        return async function (...a) {
            const op = new cls();
            op.self = this;
            return await op.run(...a);
        }
    }
}

module.exports = {
    CodeUtil,
};
