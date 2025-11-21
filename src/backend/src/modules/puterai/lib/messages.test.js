import { describe, it, expect } from 'vitest';
const Messages = require('./Messages.js');
const OpenAIUtil = require('./OpenAIUtil.js');

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
                        },
                    ],
                },
            },
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = Messages.normalize_single_message(tc.input);
                expect(output).toEqual(tc.output);
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
                        },
                    ],
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
                            },
                        ],
                    },
                    {
                        content: 'Third Part',
                    },
                ],
                output: 'First Part Second Part Third Part',
            },
        ];
        for ( const tc of cases ) {
            it(`should extract text from ${tc.name}`, () => {
                const output = Messages.extract_text(tc.input);
                expect(output).toBe(tc.output);
            });
        }
    });
    describe('normalize OpenAI tool calls', () => {
        const cases = [
            {
                name: 'string message',
                input: {
                    role: 'assistant',
                    tool_calls: [
                        {
                            id: 'tool-1',
                            type: 'function',
                            function: {
                                name: 'tool-1-function',
                                arguments: {},
                            },
                        },
                    ],
                },
                output: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: {},
                        },
                    ],
                },
            },
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = Messages.normalize_single_message(tc.input);
                expect(output).toEqual(tc.output);
            });
        }
    });
    describe('normalize Claude tool calls', () => {
        const cases = [
            {
                name: 'string message',
                input: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: '{}',
                        },
                    ],
                },
                output: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: '{}',
                        },
                    ],
                },
            },
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = Messages.normalize_single_message(tc.input);
                expect(output).toEqual(tc.output);
            });
        }
    });
    describe('OpenAI-ify normalized tool calls', () => {
        const cases = [
            {
                name: 'string message',
                input: [{
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: {},
                        },
                    ],
                }],
                output: [{
                    role: 'assistant',
                    content: null,
                    tool_calls: [
                        {
                            id: 'tool-1',
                            type: 'function',
                            function: {
                                name: 'tool-1-function',
                                arguments: '{}',
                            },
                        },
                    ],
                }],
            },
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, async () => {
                const output = await OpenAIUtil.process_input_messages(tc.input);
                expect(output).toEqual(tc.output);
            });
        }
    });
});