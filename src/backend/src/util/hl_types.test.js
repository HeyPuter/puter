const { expect } = require('chai');
const { boolify } = require('./hl_types');

describe('hl_types', () => {
    it('boolify falsy values', () => {
        expect(boolify(undefined)).to.be.false;
        expect(boolify(0)).to.be.false;
        expect(boolify('')).to.be.false;
        expect(boolify(null)).to.be.false;
    })
    it('boolify truthy values', () => {
        expect(boolify(true)).to.be.true;
        expect(boolify(1)).to.be.true;
        expect(boolify('1')).to.be.true;
        expect(boolify({})).to.be.true;
    })
});