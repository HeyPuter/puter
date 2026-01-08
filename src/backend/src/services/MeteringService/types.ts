import type { AlarmService } from '../../modules/core/AlarmService';
import type { EventService } from '../EventService';
import { DynamoKVStore } from '../repositories/DynamoKVStore/DynamoKVStore';
import type { SUService } from '../SUService';

export interface UsageAddons {
    purchasedCredits: number // total extra credits purchased - not expirable
    consumedPurchaseCredits: number // total credits consumed from purchased ones - these are flattened upon new 'purchase'
    purchasedStorage: number // TODO DS: not implemented yet
    rateDiscounts: {
        [usageType: string]: number | string // TODO DS: string to support graduated discounts eventually
    }
}

export interface RecursiveRecord<T> { [k: string]: T | RecursiveRecord<T> }

export interface UsageRecord {
    cost: number,
    count: number,
    units: number
}

export type UsageByType = { total: number } & Partial<Record<Exclude<string, 'total'>, UsageRecord>>;

export interface AppTotals {
    total: number,
    count: number
}
export interface MeteringServiceDeps {
    kvStore: DynamoKVStore,
    superUserService: SUService,
    alarmService: AlarmService
    eventService: EventService
}
