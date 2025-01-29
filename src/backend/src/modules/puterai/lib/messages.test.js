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
    describe('extract_text', () => {
        const cases = [
            {
                name: 'string message',
                input: ['Hello, world!'],
                output: 'Hello, world!',
            },
            {
                name: 'object message',
                input: [{
                    content: [
                        {
                            type: 'text',
                            text: 'Hello, world!',
                        }
                    ]
                }],
                output: 'Hello, world!',
            },
            {
                name: 'irregular messages',
                input: [
                    'First Part',
                    {
                        content: [
                            {
                                type: 'text',
                                text: 'Second Part',
                            }
                        ]
                    },
                    {
                        content: 'Third Part',
                    }
                ],
                output: 'First Part Second Part Third Part',
            }
        ];
        for ( const tc of cases ) {
            it(`should extract text from ${tc.name}`, () => {
                const output = Messages.extract_text(tc.input);
                expect(output).to.equal(tc.output);
            });
        }
    });
});
