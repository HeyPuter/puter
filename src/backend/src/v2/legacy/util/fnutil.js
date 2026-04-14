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
const UtilFn = fn => {
    /**
     * A null-coalescing call
     */
    fn.if = function utilfn_if (v) {
        if ( v === null || v === undefined ) return v;
        return this(v);
    };
    return fn;
};

const OnlyOnceFn = fn => {
    let called = false;
    return function onlyoncefn_call (...args) {
        if ( called ) return;
        called = true;
        return fn(...args);
    };
};

module.exports = {
    UtilFn,
    OnlyOnceFn,
};
