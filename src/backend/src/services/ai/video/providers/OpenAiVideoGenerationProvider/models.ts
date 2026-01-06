import { IVideoModel } from '../types';

export const OPENAI_VIDEO_ALLOWED_SIZES = ['720x1280', '1280x720', '1024x1792', '1792x1024'] as const;
export const OPENAI_VIDEO_ALLOWED_SECONDS = [4, 8, 12] as const;

export const OPENAI_VIDEO_MODELS: IVideoModel[] = [
    {
        id: 'sora-2',
        name: 'Sora 2',
        version: '1.0',
        costs_currency: 'usd-cents',
        costs: {
            default: 10, // $0.10 per second
        },
        allowedDurationsSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        allowedResolutions: OPENAI_VIDEO_ALLOWED_SIZES.slice(),
        defaultUsageKey: 'openai:sora-2:default',
    },
    {
        id: 'sora-2-pro',
        name: 'Sora 2 Pro',
        version: '1.0',
        costs_currency: 'usd-cents',
        costs: {
            default: 30, // $0.30 per second
            xl: 50, // $0.50 per second for XL resolutions
        },
        allowedDurationsSeconds: OPENAI_VIDEO_ALLOWED_SECONDS.slice(),
        allowedResolutions: OPENAI_VIDEO_ALLOWED_SIZES.slice(),
        defaultUsageKey: 'openai:sora-2-pro:default',
    },
];
