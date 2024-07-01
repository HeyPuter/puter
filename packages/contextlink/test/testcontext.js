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
import assert from 'assert';
import { Context } from "../context.js";

describe('context', () => {
    it ('works', () => {
        const ctx = new Context({ a: 1 });
        const subCtx = ctx.sub({ b: 2 });

        assert.equal(ctx.a, 1);
        assert.equal(ctx.b, undefined);
        assert.equal(subCtx.a, 1);
        assert.equal(subCtx.b, 2);
    }),
    it ('doesn\'t mangle inner-contexts', () => {
        const ctx = new Context({
            plainObject: { a: 1, b: 2, c: 3 },
            contextObject: new Context({ i: 4, j: 5, k: 6 }),
        });
        const subCtx = ctx.sub({
            plainObject: { a: 101 },
            contextObject: { i: 104 },
        });
        assert.equal(subCtx.plainObject.a, 101);
        assert.equal(subCtx.plainObject.b, undefined);

        assert.equal(subCtx.contextObject.i, 104);
        assert.equal(subCtx.contextObject.j, 5);

    })
});
