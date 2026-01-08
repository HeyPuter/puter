import { SUB_POLICIES } from './MeteringService/subPolicies';

export interface IUser {
    id: number,
    uuid: string,
    username: string,
    email?: string,
    subscription?: (typeof SUB_POLICIES)[number]['id'] & {active: boolean, tier: string},
    metadata?: Record<string, unknown> & { hasDevAccountAccess?: boolean }
}