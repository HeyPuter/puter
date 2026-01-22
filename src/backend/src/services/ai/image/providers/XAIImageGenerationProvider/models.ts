import { IImageModel } from '../types';

export const XAI_IMAGE_GENERATION_MODELS: IImageModel[] = [
    {
        puterId: 'x-ai:x-ai/grok-2-image',
        id: 'grok-2-image',
        aliases: ['grok-image', 'x-ai/grok-image', 'x-ai/grok-2-image'],
        name: 'Grok 2 Image',
        version: '1.0',
        costs_currency: 'usd-cents',
        index_cost_key: 'output',
        costs: {
            output: 7, // $0.07 per image
        },
    },
];
