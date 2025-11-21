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
const { BasicBase } = require('../src/bases/BasicBase');
const { AdvancedBase } = require('../src/AdvancedBase');
const { Invoker } = require('../src/libs/invoker');

class ClassA extends BasicBase {
    static STATIC_OBJ = {
        a: 1,
        b: 2,
    };
    static STATIC_ARR = ['a', 'b'];
}

class ClassB extends ClassA {
    static STATIC_OBJ = {
        c: 3,
        d: 4,
    };
    static STATIC_ARR = ['c', 'd'];
}

describe('testing', () => {
    it('does a thing', () => {
        const b = new ClassB();

        console.log(b._get_inheritance_chain());
        console.log([ClassA, ClassB]);
        expect(b._get_inheritance_chain()).deep.equal([ClassA, ClassB]);
        expect(b._get_merged_static_array('STATIC_ARR'))
            .deep.equal(['a', 'b', 'c', 'd']);
        expect(b._get_merged_static_object('STATIC_OBJ'))
            .deep.equal({ a: 1, b: 2, c: 3, d: 4 });
    });
});

class ClassWithModule extends AdvancedBase {
    static MODULES = {
        axios: 'axios',
    };
}

describe('AdvancedBase', () => {
    it('passes DI modules to instance', () => {
        const c1 = new ClassWithModule();
        expect(c1.modules.axios).to.equal('axios');

        const c2 = new ClassWithModule({
            modules: {
                axios: 'my-axios',
            },
        });
        expect(c2.modules.axios).to.equal('my-axios');
    });
});

describe('lib:invoker', () => {
    it('works', async () => {
        const invoker = Invoker.create({
            decorators: [
                {
                    name: 'uphill both ways',
                    on_call: (args) => {
                        return {
                            ...args,
                            n: args.n + 1,
                        };
                    },
                    on_return: (result) => {
                        return {
                            n: result.n + 1,
                        };
                    },
                },
                {
                    name: 'error number five',
                    on_error: a => {
                        a.cancel_error();
                        return { n: 5 };
                    },
                },
            ],
            async delegate (args) {
                const { n } = args;
                if ( n === 3 ) {
                    throw new Error('test error');
                }
                return { n: 'oops' };
            },
        });
        expect(await invoker.run({ n: 2 })).to.deep.equal({ n: 6 });
    });
});
