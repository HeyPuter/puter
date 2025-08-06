import { describe, it, expect } from 'vitest';

import commonRegistrants from './common/index.js';
import { NORMALIZED_LLM_MESSAGES, NORMALIZED_SINGLE_MESSAGE, UNIVERSAL_LLM_MESSAGES, UNIVERSAL_SINGLE_MESSAGE } from './airouter';
import { Registry } from './core/Registry';

describe('normalize', () => {
    const registry = new Registry();
    
    const define = registry.getDefineAPI();
    commonRegistrants(define);
    
    const obtain = registry.getObtainAPI();

    it('converts strings into message with content parts', async () => {
        const universal_messages = [
            'fox of quick brown, jump over the lazy dogs',
            'the black quartz sphinx judges over the funny vow',
        ];
        
        const output = await obtain(NORMALIZED_LLM_MESSAGES, {
            [UNIVERSAL_LLM_MESSAGES]: universal_messages,
        });
        
        expect(output.length).toBe(1);

        const message = output[0];
        expect(typeof message).toBe('object');
        expect(message?.content?.length).toBe(universal_messages.length);
        expect(message?.content?.length).not.toBe(0);
        
        for ( let i=0 ; i < output.length ; i++ ) {
            expect(message?.content?.[0]?.text).toBe(universal_messages[i])
        }
    });
    
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
        it(`should normalize ${tc.name}`, async () => {
            const output = await obtain(NORMALIZED_SINGLE_MESSAGE, {
                [UNIVERSAL_SINGLE_MESSAGE]: tc.input,
            });
            expect(output).toEqual(tc.output);
        });
    }
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
            it(`should normalize ${tc.name}`, async () => {
                const output = await obtain(NORMALIZED_SINGLE_MESSAGE, {
                    [UNIVERSAL_SINGLE_MESSAGE]: tc.input,
                });
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
            it(`should normalize ${tc.name}`, async () => {
                const output = await obtain(NORMALIZED_SINGLE_MESSAGE, {
                    [UNIVERSAL_SINGLE_MESSAGE]: tc.input,
                });
                expect(output).toEqual(tc.output);
            });
        }
    });
});