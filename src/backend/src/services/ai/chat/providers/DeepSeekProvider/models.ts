import { IChatModel } from '../types.js';

// Hardcoded from https://models.dev/api.json
export const DEEPSEEK_MODELS: IChatModel[] = [
    {
        puterId: 'deepseek:deepseek/deepseek-chat',
        id: 'deepseek-chat',
        modalities: { 'input': ['text'], 'output': ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-07',
        release_date: '2024-12-26',
        name: 'DeepSeek Chat',
        aliases: ['deepseek/deepseek-chat'],
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
        puterId: 'deepseek:deepseek/deepseek-reasoner',
        id: 'deepseek-reasoner',
        modalities: { 'input': ['text'], 'output': ['text'] },
        open_weights: false,
        tool_call: true,
        knowledge: '2024-07',
        release_date: '2025-01-20',
        name: 'DeepSeek Reasoner',
        aliases: ['deepseek/deepseek-reasoner'],
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
