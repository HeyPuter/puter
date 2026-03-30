import { SUB_POLICIES } from './MeteringService/subPolicies';

export interface IUser {
    id: number;
    uuid: string;
    username: string;
    email?: string;
    free_storage?: number | string | null;
    actual_free_storage?: number | string | null;
    subscription?: (typeof SUB_POLICIES)[number]['id'] & {
        active: boolean;
        tier: string;
    };
    metadata?: Record<string, unknown> & { hasDevAccountAccess?: boolean };
    repscore: number;
    email_confirmed: 1 | 0;
    requires_email_confirmation: 1 | 0;
}
