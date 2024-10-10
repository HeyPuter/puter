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