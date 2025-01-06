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

const { Context } = require('../src/libs/context');
const { expect } = require('chai');

describe('context', () => {
    it('works', () => {
        const c0 = new Context({
            a: 1, b: 2,
        });
        const c1 = c0.sub({
            b: 3
        });

        expect(c0.a).to.equal(1);
        expect(c0.b).to.equal(2);
        expect(c1.a).to.equal(1);
        expect(c1.b).to.equal(3);
    });
});
