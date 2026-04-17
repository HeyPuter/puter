import { generate_random_code } from '../../util/identifier.js';

/**
 * Generate a unique referral code for a user and persist it.
 *
 * The code is 8 chars of `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`.
 * Retries up to 5 times on UNIQUE constraint collision. Returns the
 * generated code, or null if all retries fail.
 *
 * The code is also written as the user's `referral_code` column.
 */
export async function generateReferralCode (userStore, user) {
    if ( ! user?.id ) throw new Error('user with id required');
    const TRIES = 5;
    let lastError = null;
    for ( let i = 0; i < TRIES; i++ ) {
        const code = generate_random_code(8);
        try {
            await userStore.update(user.id, { referral_code: code });
            return code;
        } catch (e) {
            lastError = e;
        }
    }
    console.warn('[referral] failed to generate unique code after retries:', lastError);
    return null;
}
