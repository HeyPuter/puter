import { IVideoModel } from '../types';

export const TOGETHER_VIDEO_MODELS: IVideoModel[] = [
    {
        id: 'minimax/video-01-director',
        name: 'MiniMax Director 01',
        version: '1.0',
        costs_currency: 'usd-cents',
        costs: {
            default: 14, // $0.14 per video (placeholder per Together pricing map)
        },
        allowedDurationsSeconds: [6],
        allowedResolutions: [],
        defaultUsageKey: 'together-video:minimax/video-01-director',
    },
];
