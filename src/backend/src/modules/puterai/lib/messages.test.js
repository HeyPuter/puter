const { expect } = require('chai');
const Messages = require('./Messages.js');

describe('Messages', () => {
    describe('normalize_single_message', () => {
        const cases = [
            {
                name: 'string message',
                input: 'Hello, world!',
                output: {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: 'Hello, world!',
                        }
                    ]
                }
            }
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = Messages.normalize_single_message(tc.input);
                expect(output).to.deep.equal(tc.output);
            });
        }
    });
});
