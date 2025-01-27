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

const { RemoveFromArrayDetachable } = require("../src/libs/listener");
const { expect } = require('chai');
const { TDetachable } = require("../src/traits/traits");

describe('RemoveFromArrayDetachable', () => {
    it ('does the thing', () => {
        const someArray = [];

        const add_listener = (key, lis) => {
            someArray.push(lis);
            return new RemoveFromArrayDetachable(someArray, lis);
        }

        const det = add_listener('test', () => {
            console.log('i am test func');
        });

        expect(someArray.length).to.equal(1);

        det.as(TDetachable).detach();

        expect(someArray.length).to.equal(0);
    })
})
