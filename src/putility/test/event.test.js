const { Emitter } = require("../src/libs/event");
const { expect } = require('chai');

describe('Emitter', () => {
    it('has EmitterFeature installed', async () => {
        const em = new Emitter();
        let value = false;
        em.on('test', () => {
            value = true;
        });
        await em.emit('test');
        expect(value).to.equal(true);
    })
})
