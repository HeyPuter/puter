import { toMicroCents } from '../../../../services/metering/utils.js';
import type { IChatModel } from '../../types.js';

export const OPEN_ROUTER_MODEL_OVERRIDES: IChatModel[] = [
    {
        id: 'openrouter:perplexity/sonar-deep-research',
        subscriberOnly: true,
        minimumCredits: toMicroCents(2),
    } as IChatModel,
];
