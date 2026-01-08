import { REGISTERED_USER_FREE } from './registeredUserFreePolicy.js';
import { TEMP_USER_FREE } from './tempUserFreePolicy.js';

export const SUB_POLICIES = [
    TEMP_USER_FREE,
    REGISTERED_USER_FREE,
] as const;