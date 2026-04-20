import { toMicroCents } from '../../services/metering/utils.js';

// Prices are per generated video-second.
export const OPENAI_VIDEO_COST_MAP = {
    'openai:sora-2:default': toMicroCents(0.1),
    'openai:sora-2-pro:default': toMicroCents(0.3),
    'openai:sora-2-pro:xl': toMicroCents(0.5),
    'openai:sora-2-pro:xxl': toMicroCents(0.7),
};
