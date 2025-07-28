module.exports = [
    {
        id: 'chatcmpl-AvspmQTvFBBjKsFhHYhyiphFmKMY8',
        object: 'chat.completion.chunk',
        created: 1738358842,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_bd83329f63',
        choices: [
            {
                index: 0,
                delta: {
                    role: "assistant",
                    content: "",
                    refusal: null
                },
                logprobs: null,
                finish_reason: null
            }
        ],
        usage: null
    },
    ...[
        `Fish`, ` are`, ` diverse`, ` aquatic`, ` creatures`, ` that`, ` play`,
        ` a`, ` crucial`, ` role`, ` in`, ` marine`, ` ecosystems`, ` and`,
        ` human`, ` diets`, `.`
    ].map(str => ({
        id: 'chatcmpl-AvspmQTvFBBjKsFhHYhyiphFmKMY8',
        object: 'chat.completion.chunk',
        created: 1738358842,
        model: 'gpt-4o-mini-2024-07-18',
        service_tier: 'default',
        system_fingerprint: 'fp_bd83329f63',
        choices: [
          {
            index: 0,
            delta: {
                content: str
            },
            logprobs: null,
            finish_reason: null
        }
        ],
        usage: null
    })),
];
