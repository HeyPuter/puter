import type { DatabaseClient } from '../clients/database/DatabaseClient';
import type { RedisClient } from '../clients/redis/RedisClient';
import type { EmailClient } from '../clients/email/EmailClient';
import type { NotificationService } from '../services/notification/NotificationService';
import type { MeteringService } from '../services/metering/MeteringService';
import type { UserRow, UserStore } from '../stores/user/UserStore';
import { toMicroCents } from '../services/metering/utils';

/**
 * Grant storage + metering credit to a referrer when a newly-verified user
 * had that referrer's `referral_code` on signup:
 *
 *   - +1 GiB `free_storage` for BOTH users (refer-L and refer-R audit tags).
 *   - +$0.25 metering addon credit for BOTH users (microcents).
 *   - Email the referrer via the `new-referral` template.
 *   - Push an in-app notification to the referrer.
 *
 * Monthly cap: 20 referrals per referring user, counted via Redis with a
 * key that expires at month-end. Once exceeded, the rewards are silently
 * skipped but the audit counter still bumps.
 *
 * Best-effort everywhere — any single failure logs a warning and continues.
 * Called from the two sites that emit `user.email-confirmed`
 * (AuthController `/confirm-email`, StaticPagesController `/confirm-email-by-token`).
 */

const STORAGE_BONUS_BYTES = 1024 * 1024 * 1024; // 1 GiB
const CREDIT_BONUS_USD = 0.25;
const MONTHLY_REFERRAL_CAP = 20;

interface Deps {
    db: DatabaseClient;
    redis: RedisClient | undefined;
    email: EmailClient | undefined;
    notification: NotificationService | undefined;
    metering: MeteringService | undefined;
    userStore: UserStore;
}

export async function applyReferralRewards(
    deps: Deps,
    newUser: UserRow,
): Promise<void> {
    const referredBy = newUser.referred_by as number | undefined;
    if (!referredBy) return;

    const referrer = await deps.userStore.getById(Number(referredBy));
    if (!referrer) return;

    // Monthly cap — keyed by YYYY-MM so it naturally rolls at month boundary.
    // No Redis = no cap enforcement; better than failing the verification.
    if (deps.redis) {
        try {
            const month = new Date().toISOString().slice(0, 7);
            const key = `referral:monthly:user:${referrer.id}:month:${month}`;
            const count = await deps.redis.incr(key);
            if (count === 1) {
                // First increment this month — set expiry to end of month.
                const now = new Date();
                const endOfMonth = new Date(
                    now.getFullYear(),
                    now.getMonth() + 1,
                    1,
                ).getTime();
                const ttlSeconds = Math.ceil(
                    (endOfMonth - now.getTime()) / 1000,
                );
                await deps.redis.expire(key, ttlSeconds);
            }
            if (count > MONTHLY_REFERRAL_CAP) return;
        } catch (e) {
            console.warn(
                '[referral] cap check failed, proceeding:',
                (e as Error).message,
            );
        }
    }

    // Storage + credit for both parties — write them in one SQL for referrer
    // and one for new user so the UPDATEs stay atomic per-row.
    try {
        await deps.db.write(
            'UPDATE `user` SET `free_storage` = COALESCE(`free_storage`, 0) + ? WHERE `id` IN (?, ?)',
            [STORAGE_BONUS_BYTES, referrer.id, newUser.id],
        );
        await deps.userStore.invalidateById(referrer.id);
        await deps.userStore.invalidateById(newUser.id);
    } catch (e) {
        console.warn('[referral] storage grant failed:', (e as Error).message);
    }

    if (deps.metering) {
        const micro = toMicroCents(CREDIT_BONUS_USD);
        try {
            await deps.metering.updateAddonCredit(referrer.uuid, micro);
        } catch (e) {
            console.warn(
                '[referral] referrer credit failed:',
                (e as Error).message,
            );
        }
        try {
            await deps.metering.updateAddonCredit(newUser.uuid, micro);
        } catch (e) {
            console.warn(
                '[referral] new-user credit failed:',
                (e as Error).message,
            );
        }
    }

    if (deps.email && referrer.email) {
        try {
            await deps.email.send('new-referral', referrer.email, {
                storage_increase: '1 GB',
            });
        } catch (e) {
            console.warn('[referral] email send failed:', (e as Error).message);
        }
    }

    if (deps.notification) {
        try {
            await deps.notification.notify([referrer.id], {
                source: 'referral',
                icon: 'c-check.svg',
                text: `You have referred user ${newUser.username} and have received 1 GB of storage.`,
                template: 'referral',
                fields: {
                    storage_increase: '1 GB',
                    referred_username: newUser.username,
                },
            });
        } catch (e) {
            console.warn(
                '[referral] notification failed:',
                (e as Error).message,
            );
        }
    }
}
