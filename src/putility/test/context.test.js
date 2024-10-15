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
