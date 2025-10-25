import type { AlarmService } from '../../modules/core/AlarmService';
import type { EventService } from '../EventService';
import type { DBKVStore } from '../repositories/DBKVStore/DBKVStore';
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

export type UsageByType = { [k:string]: number | UsageRecord } & { total: number };

export interface AppTotals {
    total: number,
    count: number
}
export interface MeteringServiceDeps {
    kvStore: DBKVStore,
    superUserService: SUService,
    alarmService: AlarmService
    eventService: EventService
}