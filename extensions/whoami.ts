import { Context } from '@heyputer/backend/src/core';
import { extension } from '@heyputer/backend/src/extensions';
import { getTaskbarItems } from '@heyputer/backend/src/util/taskbarItems.js';
import TimeAgo from 'javascript-time-ago';
import localeEn from 'javascript-time-ago/locale/en';

const stores   = extension.import('store');
const services = extension.import('service');
const clients  = extension.import('client');

const timeago = (() => {
    TimeAgo.addDefaultLocale(localeEn);
    return new TimeAgo('en-US');
})();

extension.get('/whoami', { subdomain: 'api', requireAuth: true }, async (req, res) => {
    const actor = Context.get('actor');
    if ( ! actor?.user?.id ) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const isUser = !actor.app;
    const user = await stores.user.getById(actor.user.id);
    if ( ! user ) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const oidcOnly = user.password === null;
    const iconSize = typeof req.query?.icon_size === 'string' ? Number(req.query.icon_size) : undefined;
    const noIcons = !iconSize;

    // Feature flags come from config. Shape is a flat
    // `{ flag_name: boolean }` object under `config.feature_flags`. Keys
    // that resolve to non-booleans (e.g. someone wrote `"true"` as a
    // string) are coerced so the client never has to guess.
    const cfg = extension.config as Record<string, unknown>;
    const rawFlags = (cfg.feature_flags ?? {}) as Record<string, unknown>;
    const feature_flags: Record<string, boolean> = {};
    for ( const [k, v] of Object.entries(rawFlags) ) {
        feature_flags[k] = Boolean(v);
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
        is_temp: (user.password === null && user.email === null),
        oidc_only: oidcOnly,
        taskbar_items: isUser
            ? await getTaskbarItems(user, {
                clients,
                stores,
                services,
                apiBaseUrl: String((extension.config as Record<string, unknown>).api_base_url ?? ''),
            }, { iconSize, noIcons })
            : undefined,
        referral_code: user.referral_code,
        otp: !!user.otp_enabled,
        feature_flags,
        human_readable_age: user.timestamp
            ? timeago.format(new Date(user.timestamp as string))
            : null,
    };

    // OIDC revalidate URL for password-less accounts
    if ( oidcOnly ) {
        try {
            const providers = await services.oidc.getEnabledProviderIds();
            const provider = providers?.[0];
            if ( provider ) {
                const callbackUrl = services.oidc.getCallbackUrl?.('login') ?? '';
                const origin = callbackUrl.replace(/\/auth\/oidc\/callback\/login$/, '');
                details.oidc_revalidate_url = `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_id=${user.id}`;
            }
        } catch {
            // OIDC not configured
        }
    }

    // Directories — only sent to user actors
    if ( isUser ) {
        const directories: Record<string, unknown> = {};
        const nameToProp: Record<string, string> = {
            desktop_uuid: `/${user.username}/Desktop`,
            appdata_uuid: `/${user.username}/AppData`,
            documents_uuid: `/${user.username}/Documents`,
            pictures_uuid: `/${user.username}/Pictures`,
            videos_uuid: `/${user.username}/Videos`,
            trash_uuid: `/${user.username}/Trash`,
        };
        for ( const k in nameToProp ) {
            directories[nameToProp[k]] = user[k];
        }
        details.directories = directories;
    }

    // Last activity
    if ( user.last_activity_ts ) {
        try {
            details.last_activity_ts = Math.round(new Date(user.last_activity_ts as string).getTime() / 1000);
        } catch {
            /* ignore parse error */
        }
    }

    // Strip sensitive fields for app actors
    if ( ! isUser ) {
        const canReadEmail = await services.permission
            .check(actor, `user:${user.uuid}:email:read`)
            .catch(() => false);
        if ( ! canReadEmail ) {
            delete details.email;
            delete details.unconfirmed_email;
        }
        delete details.desktop_bg_url;
        delete details.desktop_bg_color;
        delete details.desktop_bg_fit;
        delete details.human_readable_age;
    }

    if ( actor.app ) {
        details.app_name = actor.app.uid;
    }

    res.json(details);
});
