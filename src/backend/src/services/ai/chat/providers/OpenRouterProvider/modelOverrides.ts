import { toMicroCents } from '../../../../MeteringService/utils';
import { IChatModel } from '../types';

export const OPEN_ROUTER_MODEL_OVERRIDES: IChatModel[] = [
    {
        id: 'openrouter:perplexity/sonar-deep-research',
        subscriberOnly: true,
        minimumCredits: toMicroCents(2),
    } as IChatModel,
];