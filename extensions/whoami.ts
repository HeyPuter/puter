import { Context } from '@heyputer/backend/src/core';
import { extension } from '@heyputer/backend/src/extensions';
import { getTaskbarItems } from '@heyputer/backend/src/util/taskbarItems.js';
import TimeAgo from 'javascript-time-ago';
import localeEn from 'javascript-time-ago/locale/en';

const stores = extension.import('store');
const services = extension.import('service');
const clients = extension.import('client');

const timeago = (() => {
    TimeAgo.addDefaultLocale(localeEn);
    return new TimeAgo('en-US');
})();

// Allowlist of `config.feature_flags` keys safe to surface via /whoami.
// Anything not listed here stays server-side, so internal flags
// (payment_bypass, staff_only_*, etc.) cannot leak by accident. Add a
// flag here when, and only when, the client actually needs to read it.
const CLIENT_VISIBLE_FEATURE_FLAGS: ReadonlySet<string> = new Set([
    'create_shortcut',
    'download_directory',
    'prompt_user_when_navigation_away_from_puter',
]);

extension.get(
    '/whoami',
    { subdomain: 'api', requireAuth: true },
    async (req, res) => {
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

        const details: Record<string, unknown> = {
            username: user.username,
            uuid: user.uuid,
            email: user.email,
            unconfirmed_email: user.email,
            email_confirmed: user.email_confirmed || user.username === 'admin',
            requires_email_confirmation: user.requires_email_confirmation,
            desktop_bg_url: user.desktop_bg_url,
            desktop_bg_color: user.desktop_bg_color,
            desktop_bg_fit: user.desktop_bg_fit,
            is_temp: user.password === null && user.email === null,
            oidc_only: oidcOnly,
            taskbar_items: isUser
                ? await getTaskbarItems(
                      user,
                      {
                          clients,
                          stores,
                          services,
                          apiBaseUrl: String(
                              extension.config.api_base_url ?? '',
                          ),
                      },
                      { iconSize, noIcons },
                  )
                : undefined,
            otp: !!user.otp_enabled,
            feature_flags,
            human_readable_age: user.timestamp
                ? timeago.format(new Date(user.timestamp as string))
                : null,
        };

        // OIDC revalidate URL for password-less accounts
        if (oidcOnly) {
            try {
                const providers = await services.oidc.getEnabledProviderIds();
                const provider = providers?.[0];
                if (provider) {
                    const callbackUrl =
                        services.oidc.getCallbackUrl?.('login') ?? '';
                    const origin = callbackUrl.replace(
                        /\/auth\/oidc\/callback\/login$/,
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
        if (user.last_activity_ts) {
            try {
                details.last_activity_ts = Math.round(
                    new Date(user.last_activity_ts as string).getTime() / 1000,
                );
            } catch {
                /* ignore parse error */
            }
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

        res.json(details);
    },
);
