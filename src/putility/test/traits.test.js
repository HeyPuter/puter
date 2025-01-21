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

const { expect } = require('chai');
const { AdvancedBase } = require("../src/AdvancedBase");

class TestClass extends AdvancedBase {
    static IMPLEMENTS = {
        test_trait: {
            test_method: () => 'A'
        },
        override_trait: {
            preserved_method: () => 'B',
            override_method: () => 'C',
        },
    }
}

class TestSubClass extends TestClass {
    static IMPLEMENTS = {
        override_trait: {
            override_method: () => 'D',
        }
    }
}

describe('traits', () => {
    it('instance.as', () => {
        const o = new TestClass();
        expect(o.as).to.be.a('function');
        const ot = o.as('test_trait');
        expect(ot.test_method).to.be.a('function');
        expect(ot.test_method()).to.equal('A');
    });
    it('traits of parent', () => {
        const o = new TestSubClass();
        console.log(o._get_merged_static_object('IMPLEMENTS'))
        expect(o.as).to.be.a('function');
        const ot = o.as('test_trait');
        expect(ot.test_method).to.be.a('function');
        expect(ot.test_method()).to.equal('A');
    })
    it('trait method overrides', () => {
        const o = new TestSubClass();
        expect(o.as).to.be.a('function');
        const ot = o.as('override_trait');
        expect(ot.preserved_method).to.be.a('function');
        expect(ot.override_method).to.be.a('function');
        expect (ot.preserved_method()).to.equal('B');
        expect (ot.override_method()).to.equal('D');
    })
});