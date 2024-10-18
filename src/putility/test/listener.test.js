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
