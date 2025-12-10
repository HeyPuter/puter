import { IChatModel } from '../types.js';

const makeModel = ({
    id,
    name,
    context,
    input,
    output,
    aliases,
}: {
    id: string;
    name: string;
    context: number;
    input: number;
    output: number;
    aliases?: string[];
}): IChatModel => ({
    id,
    name,
    aliases,
    context,
    costs_currency: 'usd-cents',
    input_cost_key: 'prompt_tokens',
    output_cost_key: 'completion_tokens',
    costs: {
        tokens: 1_000_000,
        prompt_tokens: input,
        completion_tokens: output,
    },
    max_tokens: context,
});

export const XAI_MODELS: IChatModel[] = [
    makeModel({
        id: 'xai/grok-beta',
        aliases: ['grok-beta'],
        name: 'Grok Beta',
        context: 131072,
        input: 500,
        output: 1500,
    }),
    makeModel({
        id: 'xai/grok-vision-beta',
        aliases: ['grok-vision-beta'],
        name: 'Grok Vision Beta',
        context: 8192,
        input: 500,
        output: 1500,
    }),
    makeModel({
        id: 'xai/grok-3',
        aliases: ['grok-3'],
        name: 'Grok 3',
        context: 131072,
        input: 300,
        output: 1500,
    }),
    makeModel({
        id: 'xai/grok-3-fast',
        aliases: ['grok-3-fast'],
        name: 'Grok 3 Fast',
        context: 131072,
        input: 500,
        output: 2500,
    }),
    makeModel({
        id: 'xai/grok-3-mini',
        aliases: ['grok-3-mini'],
        name: 'Grok 3 Mini',
        context: 131072,
        input: 30,
        output: 50,
    }),
    makeModel({
        id: 'xai/grok-3-mini-fast',
        aliases: ['grok-3-mini-fast'],
        name: 'Grok 3 Mini Fast',
        context: 131072,
        input: 60,
        output: 400,
    }),
    makeModel({
        id: 'xai/grok-2-vision',
        aliases: ['grok-2-vision'],
        name: 'Grok 2 Vision',
        context: 8192,
        input: 200,
        output: 1000,
    }),
    makeModel({
        id: 'xai/grok-2',
        aliases: ['grok-2'],
        name: 'Grok 2',
        context: 131072,
        input: 200,
        output: 1000,
    }),
];
