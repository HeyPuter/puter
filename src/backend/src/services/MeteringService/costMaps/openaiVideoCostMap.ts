import { toMicroCents } from '../utils';

// Prices are per generated video-second.
export const OPENAI_VIDEO_COST_MAP = {
    'openai:sora-2:default': toMicroCents(0.10),
    'openai:sora-2-pro:default': toMicroCents(0.30),
    'openai:sora-2-pro:xl': toMicroCents(0.50),
};
