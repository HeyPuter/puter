// TODO DS: centralize somewhere

export const OPEN_AI_MODELS = [
    {
        id: 'gpt-5.1',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 125,
            output: 1000,
        },
        max_tokens: 128000,
    },
    {   
        id: 'gpt-5.1-codex',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 125,
            output: 1000,
        },
        max_tokens: 400000,
    },
    {
        id: 'gpt-5.1-codex-mini',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 25,
            output: 200,
        },
        max_tokens: 400000,
    },
    {
        id: 'gpt-5.1-chat-latest',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 125,
            output: 1000,
        },
        max_tokens: 400000,
    },
    {
        id: 'gpt-5-2025-08-07',
        aliases: ['gpt-5'],
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 125,
            output: 1000,
        },
        max_tokens: 128000,
    },
    {
        id: 'gpt-5-mini-2025-08-07',
        aliases: ['gpt-5-mini'],
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 25,
            output: 200,
        },
        max_tokens: 128000,
    },
    {
        id: 'gpt-5-nano-2025-08-07',
        aliases: ['gpt-5-nano'],
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 5,
            output: 40,
        },
        max_tokens: 128000,
    },
    {
        id: 'gpt-5-chat-latest',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 125,
            output: 1000,
        },
        max_tokens: 16384,
    },
    {
        id: 'gpt-4o',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 250,
            output: 1000,
        },
        max_tokens: 16384,
    },
    {
        id: 'gpt-4o-mini',
        max_tokens: 16384,
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 15,
            output: 60,
        },
    },
    {
        id: 'o1',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 1500,
            output: 6000,
        },
        max_tokens: 100000,
    },
    {
        id: 'o1-mini',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 300,
            output: 1200,
        },
        max_tokens: 65536,
    },
    {
        id: 'o1-pro',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 15000,
            output: 60000,
        },
        max_tokens: 100000,
    },
    {
        id: 'o3',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 1000,
            output: 4000,
        },
        max_tokens: 100000,
    },
    {
        id: 'o3-mini',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 110,
            output: 440,
        },
        max_tokens: 100000,
    },
    {
        id: 'o4-mini',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 110,
            output: 440,
        },
        max_tokens: 100000,
    },
    {
        id: 'gpt-4.1',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 200,
            output: 800,
        },
        max_tokens: 32768,
    },
    {
        id: 'gpt-4.1-mini',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 40,
            output: 160,
        },
        max_tokens: 32768,
    },
    {
        id: 'gpt-4.1-nano',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 10,
            output: 40,
        },
        max_tokens: 32768,
    },
    {
        id: 'gpt-4.5-preview',
        cost: {
            currency: 'usd-cents',
            tokens: 1_000_000,
            input: 7500,
            output: 15000,
        },
    },
];
