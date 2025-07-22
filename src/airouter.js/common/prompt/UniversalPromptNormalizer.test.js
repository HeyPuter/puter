import { describe, it, expect } from 'vitest';
import { UniversalPromptNormalizer } from './UniversalPromptNormalizer.js';

describe('UniversalPromptUtil', () => {
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
                const output = UniversalPromptNormalizer.normalize_single_message(tc.input);
                expect(output).toEqual(tc.output);
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
                            }
                        }
                    ]
                },
                output: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: {},
                        }
                    ]
                }
            }
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = UniversalPromptNormalizer.normalize_single_message(tc.input);
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
                            input: "{}",
                        }
                    ]
                },
                output: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'tool_use',
                            id: 'tool-1',
                            name: 'tool-1-function',
                            input: "{}",
                        }
                    ]
                }
            }
        ];
        for ( const tc of cases ) {
            it(`should normalize ${tc.name}`, () => {
                const output = UniversalPromptNormalizer.normalize_single_message(tc.input);
                expect(output).toEqual(tc.output);
            });
        }
    });
});