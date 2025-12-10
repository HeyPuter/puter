import { IChatModel } from '../types.js';

export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        id: 'deepseek/deepseek-chat',
        name: 'DeepSeek Chat',
        aliases: ['deepseek-chat'],
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
        id: 'deepseek/deepseek-reasoner',
        name: 'DeepSeek Reasoner',
        aliases: ['deepseek-reasoner'],
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
