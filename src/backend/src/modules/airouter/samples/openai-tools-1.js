module.exports = [
    {
        id: 'chatcmpl-Avqr6AwmQoEFLXuwf1llkKknIR4Ry',
        object: 'chat.completion.chunk',
        created: 1738351236,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_72ed7ab54c',
        choices: [
            {
                index: 0,
                delta: {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            index: 0,
                            id: "call_ULl8cRKFQbYeJSIZ3giLAg6r",
                            type: "function",
                            function: {
                                name: "get_weather",
                                arguments: ""
                            }
                        }
                    ],
                    refusal: null
                },
                logprobs: null,
                finish_reason: null
            }
        ],
        usage: null
    },
    ...[
        `{"`, `location`, `":"`,
        `V`, `ancouver`,
        `"}`
    ].map(str => ({
        id: 'chatcmpl-Avqr6AwmQoEFLXuwf1llkKknIR4Ry',
        object: 'chat.completion.chunk',
        created: 1738351236,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_72ed7ab54c',
        choices: [
            {
                index: 0,
                delta: {
                    tool_calls: [
                        {
                            index: 0,
                            function: {
                                arguments: str,
                            }
                        }
                    ]
                },
                logprobs: null,
                finish_reason: null
            }
        ],
        usage: null
    })),
    {
        id: 'chatcmpl-Avqr6AwmQoEFLXuwf1llkKknIR4Ry',
        object: 'chat.completion.chunk',
        created: 1738351236,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_72ed7ab54c',
        choices: [
            {
                index: 0,
                delta: {},
                logprobs: null,
                finish_reason: 'tool_calls'
            }
        ],
        usage: null
    },
    {
        id: 'chatcmpl-Avqr6AwmQoEFLXuwf1llkKknIR4Ry',
        object: 'chat.completion.chunk',
        created: 1738351236,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_72ed7ab54c',
        choices: [],
        usage: {
            prompt_tokens: 62,
            completion_tokens: 16,
            total_tokens: 78,
            prompt_tokens_details: { cached_tokens: 0, audio_tokens: 0 },
            completion_tokens_details: {
                reasoning_tokens: 0,
                audio_tokens: 0,
                accepted_prediction_tokens: 0,
                rejected_prediction_tokens: 0
            }
        }
    }
];
