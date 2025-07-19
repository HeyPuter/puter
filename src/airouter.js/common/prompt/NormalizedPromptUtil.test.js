import { describe, it, expect } from 'vitest';
const { NormalizedPromptUtil } = require('./NormalizedPromptUtil.js');

describe('NormalizedPromptUtil', () => {
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
                name: 'irregular message',
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
                const output = NormalizedPromptUtil.extract_text(tc.input);
                expect(output).toBe(tc.output);
            });
        }
    });
});
