import { toMicroCents } from '../utils';

export const FILE_SYSTEM_COST_MAP = {
    'filesystem:ingress:bytes': 0,
    'filesystem:delete:bytes': 0,
    'filesystem:egress:bytes': toMicroCents(0.12 / 1024 / 1024 / 1024), // $0.11 per GB ~> 0.12 per GiB
    'filesystem:cached-egress:bytes': toMicroCents(0.1 / 1024 / 1024 / 1024), // $0.09 per GB ~> 0.1 per GiB,
};