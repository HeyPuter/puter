import { IChatModel } from '../types.js';

const makeModel = ({
    puterId,
    id,
    name,
    context,
    input,
    output,
}: {
    puterId: string
    id: string;
    name: string;
    context: number;
    input: number;
    output: number;
}): IChatModel => ({
    puterId,
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
    },
    max_tokens: context,
});

export const XAI_MODELS: IChatModel[] = [
    makeModel({
        puterId: "x-ai/grok-beta",
        id: 'grok-beta',
        name: 'Grok Beta',
        context: 131072,
        input: 500,
        output: 1500,
    }),
    makeModel({
        puterId: "x-ai/grok-vision-beta",
        id: 'grok-vision-beta',
        name: 'Grok Vision Beta',
        context: 8192,
        input: 500,
        output: 1500,
    }),
    makeModel({
        puterId: "x-ai/grok-3",
        id: 'grok-3',
        name: 'Grok 3',
        context: 131072,
        input: 300,
        output: 1500,
    }),
    makeModel({
        puterId: "x-ai/grok-3-fast",
        id: 'grok-3-fast',
        name: 'Grok 3 Fast',
        context: 131072,
        input: 500,
        output: 2500,
    }),
    makeModel({
        puterId: "x-ai/grok-3-mini",
        id: 'grok-3-mini',
        name: 'Grok 3 Mini',
        context: 131072,
        input: 30,
        output: 50,
    }),
    makeModel({
        puterId: "x-ai/grok-3-mini-fast",
        id: 'grok-3-mini-fast',
        name: 'Grok 3 Mini Fast',
        context: 131072,
        input: 60,
        output: 400,
    }),
    makeModel({
        puterId: "x-ai/grok-2-vision",
        id: 'grok-2-vision',
        name: 'Grok 2 Vision',
        context: 8192,
        input: 200,
        output: 1000,
    }),
    makeModel({
        puterId: "x-ai/grok-2",
        id: 'grok-2',
        name: 'Grok 2',
        context: 131072,
        input: 200,
        output: 1000,
    }),
];
