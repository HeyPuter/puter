import { Context } from '@heyputer/backend/src/core';
import { extension } from '@heyputer/backend/src/extensions';
import { getTaskbarItems } from '@heyputer/backend/src/util/taskbarItems.js';
import type { Request, Response } from 'express';
import TimeAgo from 'javascript-time-ago';
import localeEn from 'javascript-time-ago/locale/en';

const stores = extension.import('store');
const services = extension.import('service');
const clients = extension.import('client');

const timeago = (() => {
    TimeAgo.addDefaultLocale(localeEn);
    return new TimeAgo('en-US');
})();

// User timestamps come off the DB as SQL datetime strings; the wire format
// for all of them is unix seconds. Unparseable values are dropped rather
// than sent as NaN.
const toUnixSeconds = (value: unknown): number | undefined => {
    if (!value) return undefined;
    const ms = new Date(value as string | number | Date).getTime();
    return Number.isNaN(ms) ? undefined : Math.round(ms / 1000);
};

// Allowlist of `config.feature_flags` keys safe to surface via /whoami.
// Anything not listed here stays server-side, so internal flags
// (payment_bypass, staff_only_*, etc.) cannot leak by accident. Add a
// flag here when, and only when, the client actually needs to read it.
const CLIENT_VISIBLE_FEATURE_FLAGS: ReadonlySet<string> = new Set([
    'create_shortcut',
    'download_directory',
    'prompt_user_when_navigation_away_from_puter',
]);

export const handleWhoami = async (
    req: Request,
    res: Response,
): Promise<void> => {
    const actor = Context.get('actor');
    if (!actor?.user?.id) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const isUser = !actor.app;
    const user = await stores.user.getById(actor.user.id);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const oidcOnly = user.password === null;
    const ALLOWED_ICON_SIZES = new Set([16, 32, 64, 128, 256, 512]);
    const rawIconSize =
        typeof req.query?.icon_size === 'string'
            ? Number(req.query.icon_size)
            : undefined;
    const iconSize =
        rawIconSize !== undefined && ALLOWED_ICON_SIZES.has(rawIconSize)
            ? rawIconSize
            : undefined;
    const noIcons = !iconSize;

    // Feature flags come from `config.feature_flags`. We only forward keys
    // listed in CLIENT_VISIBLE_FEATURE_FLAGS so internal flags can't leak.
    // Non-boolean values (e.g. `"true"` as a string) are coerced so the
    // client never has to guess.
    const rawFlags = extension.config.feature_flags ?? {};
    const feature_flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(rawFlags)) {
        if (CLIENT_VISIBLE_FEATURE_FLAGS.has(k)) {
            feature_flags[k] = Boolean(v);
        }
    }

    const metadata = user.metadata ? { ...user.metadata } : user.metadata;
    if (metadata) delete metadata.tmp_password;

    const details: Record<string, unknown> = {
        username: user.username,
        uuid: user.uuid,
        email: user.email,
        unconfirmed_email: user.email,
        email_confirmed: user.email_confirmed || user.username === 'admin',
        requires_email_confirmation: user.requires_email_confirmation,
        phone: user.phone,
        requires_phone_verification: user.requires_phone_verification,
        requires_card_verification: user.requires_card_verification,
        desktop_bg_url: user.desktop_bg_url,
        desktop_bg_color: user.desktop_bg_color,
        desktop_bg_fit: user.desktop_bg_fit,
        is_temp: user.password === null && user.email === null,
        is_user_token: true,
        oidc_only: oidcOnly,
        taskbar_items: isUser
            ? await getTaskbarItems(
                  user,
                  {
                      clients,
                      stores,
                      services,
                      apiBaseUrl: String(extension.config.api_base_url ?? ''),
                  },
                  { iconSize, noIcons },
              )
            : undefined,
        otp: !!user.otp_enabled,
        feature_flags,
        created_ts: toUnixSeconds(user.timestamp),
        human_readable_age: user.timestamp
            ? timeago.format(new Date(user.timestamp as string))
            : null,
        metadata,
        hasDevAccountAccess: !!user.metadata?.hasDevAccountAccess,
    };

    // OIDC revalidate URL for password-less accounts
    if (oidcOnly) {
        try {
            const provider = await services.oidc.getLinkedProviderForUser(
                user.id as number,
            );
            if (provider) {
                const origin = (extension.config.origin ?? '').replace(
                    /\/$/,
                    '',
                );
                details.oidc_revalidate_url = `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_uuid=${encodeURIComponent(user.uuid)}`;
            }
        } catch {
            // OIDC not configured
        }
    }

    // Directories — only sent to user actors
    if (isUser) {
        const directories: Record<string, unknown> = {};
        const nameToProp: Record<string, string> = {
            desktop_uuid: `/${user.username}/Desktop`,
            appdata_uuid: `/${user.username}/AppData`,
            documents_uuid: `/${user.username}/Documents`,
            pictures_uuid: `/${user.username}/Pictures`,
            videos_uuid: `/${user.username}/Videos`,
            trash_uuid: `/${user.username}/Trash`,
        };
        for (const k in nameToProp) {
            directories[nameToProp[k]] = user[k];
        }
        details.directories = directories;
    }

    // Last activity
    const lastActivityTs = toUnixSeconds(user.last_activity_ts);
    if (lastActivityTs !== undefined) {
        details.last_activity_ts = lastActivityTs;
    }

    // Strip sensitive fields for app actors
    if (!isUser) {
        const canReadEmail = await services.permission
            .check(actor, `user:${user.uuid}:email:read`)
            .catch(() => false);
        if (!canReadEmail) {
            delete details.email;
            delete details.unconfirmed_email;
        }
        delete details.desktop_bg_url;
        delete details.desktop_bg_color;
        delete details.desktop_bg_fit;
        delete details.human_readable_age;
        delete details.created_ts;
        delete details.is_user_token;
        delete details.metadata;
    }

    if (actor.app) {
        details.app_name = actor.app.uid;
    }

    try {
        await clients.event.emitAndWait(
            'whoami.details',
            { user, details, isUser },
            {},
        );
    } catch {
        /* best-effort */
    }

    const subscription = details.subscription as
        { offering?: Record<string, unknown> } | undefined;
    if (subscription?.offering) {
        delete subscription.offering.group;
        delete subscription.offering.benefits;
        delete subscription.offering.price_id;
    }

    res.json(details);
};

extension.get(
    '/whoami',
    {
        subdomain: 'api',
        requireAuth: true,
        allowUnconfirmed: true,
        // The GUI polls this, and each call fans out to every `whoami`
        // event listener — so it costs more than the response suggests.
        //
        // It is also the call everything else leans on to find out who it is
        // talking to, so it rides along with unrelated work rather than
        // arriving at its own pace: the ceiling has to clear whatever the
        // busiest session is doing, not what a person clicks.
        rateLimit: {
            scope: 'whoami',
            limit: 1_800,
            window: 60_000,
            key: 'user',
        },
    },
    handleWhoami,
);
