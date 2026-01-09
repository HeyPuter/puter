import { IChatModel } from '../types.js';

export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        puterId: "deepseek:deepseek/deepseek-chat",
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        aliases: ["deepseek/deepseek-chat"],
        context: 128000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 56,
            completion_tokens: 168,
            cached_tokens: 0,
        },
        max_tokens: 8000,
    },
    {
        puterId: "deepseek:deepseek/deepseek-reasoner",
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        aliases: ["deepseek/deepseek-reasoner"],
        context: 128000,
        costs_currency: 'usd-cents',
        input_cost_key: 'prompt_tokens',
        output_cost_key: 'completion_tokens',
        costs: {
            tokens: 1_000_000,
            prompt_tokens: 56,
            completion_tokens: 168,
            cached_tokens: 0,
        },
        max_tokens: 64000,
    },
];
