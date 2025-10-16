import type { AlarmService } from "../../modules/core/AlarmService";
import type { EventService } from "../EventService";
import type { DBKVStore } from "../repositories/DBKVStore/DBKVStore";
import type { SUService } from "../SUService";

export interface UsageAddons {
    purchasedCredits: number // total extra credits purchased - not expirable
    consumedPurchaseCredits: number // total credits consumed from purchased ones - these are flattened upon new 'purchase'
    purchasedStorage: number // TODO DS: not implemented yet
    rateDiscounts: {
        [usageType: string]: number | string // TODO DS: string to support graduated discounts eventually
    }
}
export interface UsageByType {
    total: number
    [serviceName: string]: number
}

export interface MeteringAndBillingServiceDeps {
    kvStore: DBKVStore,
    superUserService: SUService,
    alarmService: AlarmService
    eventService: EventService
}