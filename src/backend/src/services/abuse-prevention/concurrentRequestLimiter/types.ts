import { Actor } from '../../auth/Actor';

export interface SimpleLimitConfig {
    limit: number;
}

export type GroupLimitConfig = { default: SimpleLimitConfig } & Record<string, SimpleLimitConfig>;

export type ConcurrentLimitConfig = SimpleLimitConfig | GroupLimitConfig;

export interface CheckAndIncrementConcurrentOptions {
    actor: Actor;
    key: string;
    leaseMs?: number;
}

export interface ConcurrentPermit {
    key: string;
    redisKey: string;
    token: string;
    userId: string;
    userGroup: string;
    limit: number;
    expiresAt: number;
}

export interface CheckAndIncrementConcurrentResult {
    allowed: boolean;
    limit: number;
    activeCount: number;
    userGroup: string;
    permit?: ConcurrentPermit;
}
