const { expect } = require('chai');
const { BasicBase } = require('../src/bases/BasicBase');
const { AdvancedBase } = require('../src/AdvancedBase');

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

