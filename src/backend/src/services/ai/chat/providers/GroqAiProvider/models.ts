import { IChatModel } from '../types.js';

const makeModel = ({
    id,
    name,
    context,
    input,
    output,
    max_tokens,
}: {
    id: string;
    name: string;
    context?: number;
    input: number;
    output: number;
    max_tokens?: number;
}): IChatModel => ({
    id,
    name,
    context,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs: {
        tokens: 1_000_000,
        prompt_tokens: input,
        completion_tokens: output,
        cached_tokens: 0,
    },
    max_tokens: max_tokens ?? context ?? 8192,
});

export const GROQ_MODELS: IChatModel[] = [
    makeModel({
        id: 'gemma2-9b-it',
        name: 'Gemma 2 9B 8k',
        context: 8192,
        input: 20,
        output: 20,
    }),
    makeModel({
        id: 'gemma-7b-it',
        name: 'Gemma 7B 8k Instruct',
        context: 8192,
        input: 7,
        output: 7,
    }),
    makeModel({
        id: 'llama3-groq-70b-8192-tool-use-preview',
        name: 'Llama 3 Groq 70B Tool Use Preview 8k',
        context: 8192,
        input: 89,
        output: 89,
    }),
    makeModel({
        id: 'llama3-groq-8b-8192-tool-use-preview',
        name: 'Llama 3 Groq 8B Tool Use Preview 8k',
        context: 8192,
        input: 19,
        output: 19,
    }),
    makeModel({
        id: 'llama-3.1-70b-versatile',
        name: 'Llama 3.1 70B Versatile 128k',
        context: 128000,
        input: 59,
        output: 79,
    }),
    makeModel({
        id: 'llama-3.1-70b-specdec',
        name: 'Llama 3.1 8B Instant 128k',
        context: 128000,
        input: 59,
        output: 99,
    }),
    makeModel({
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant 128k',
        context: 131072,
        input: 5,
        output: 8,
        max_tokens: 131072,
    }),
    makeModel({
        id: 'meta-llama/llama-guard-4-12b',
        name: 'Llama Guard 4 12B',
        context: 131072,
        input: 20,
        output: 20,
        max_tokens: 1024,
    }),
    makeModel({
        id: 'meta-llama/llama-prompt-guard-2-86m',
        name: 'Prompt Guard 2 86M',
        context: 512,
        input: 4,
        output: 4,
        max_tokens: 512,
    }),
    makeModel({
        id: 'llama-3.2-1b-preview',
        name: 'Llama 3.2 1B (Preview) 8k',
        context: 128000,
        input: 4,
        output: 4,
    }),
    makeModel({
        id: 'llama-3.2-3b-preview',
        name: 'Llama 3.2 3B (Preview) 8k',
        context: 128000,
        input: 6,
        output: 6,
    }),
    makeModel({
        id: 'llama-3.2-11b-vision-preview',
        name: 'Llama 3.2 11B Vision 8k (Preview)',
        context: 8000,
        input: 18,
        output: 18,
    }),
    makeModel({
        id: 'llama-3.2-90b-vision-preview',
        name: 'Llama 3.2 90B Vision 8k (Preview)',
        context: 8000,
        input: 90,
        output: 90,
    }),
    makeModel({
        id: 'llama3-70b-8192',
        name: 'Llama 3 70B 8k',
        context: 8192,
        input: 59,
        output: 79,
    }),
    makeModel({
        id: 'llama3-8b-8192',
        name: 'Llama 3 8B 8k',
        context: 8192,
        input: 5,
        output: 8,
    }),
    makeModel({
        id: 'mixtral-8x7b-32768',
        name: 'Mixtral 8x7B Instruct 32k',
        context: 32768,
        input: 24,
        output: 24,
    }),
    makeModel({
        id: 'llama-guard-3-8b',
        name: 'Llama Guard 3 8B 8k',
        context: 8192,
        input: 20,
        output: 20,
    }),
];
