import { toMicroCents } from '../utils';

export const BFL_COST_MAP = {
    'bfl:flux-2-pro': toMicroCents(0.03),
    'bfl:flux-2-flex': toMicroCents(0.06),
    'bfl:flux-pro-1.1': toMicroCents(0.04),
    'bfl:flux-pro-1.1-ultra': toMicroCents(0.06),
    'bfl:flux-pro-1.1-raw': toMicroCents(0.06),
    'bfl:flux-kontext-pro': toMicroCents(0.04),
    'bfl:flux-kontext-max': toMicroCents(0.08),
    'bfl:flux-pro-1.0-fill': toMicroCents(0.05),
    'bfl:flux-pro-1.0-expand': toMicroCents(0.05),
};
