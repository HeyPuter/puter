import { Context } from '@heyputer/backend/src/core';
import { extension } from '@heyputer/backend/src/extensions';
import { APP_ICON_SIZES } from '@heyputer/backend/src/util/appIcon.js';
import {
    buildUserDetails,
    scrubSensitive,
} from '@heyputer/backend/src/util/userDetails.js';
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

// What an app actor may receive from `whoami.details` listeners. Anything
// else a listener adds describes the account, and only ships to user actors.
const APP_VISIBLE_LISTENER_KEYS: ReadonlySet<string> = new Set([
    'subscribed',
    'paid_storage',
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

    const isUser = !actor.effectiveApp;
    const user = await stores.user.getById(actor.user.id);
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }

    const rawIconSize =
        typeof req.query?.icon_size === 'string'
            ? Number(req.query.icon_size)
            : undefined;
    const iconSize =
        rawIconSize !== undefined && APP_ICON_SIZES.includes(rawIconSize)
            ? rawIconSize
            : undefined;

    const details = await buildUserDetails(
        user,
        { config: extension.config, clients, stores, services },
        { isUser, iconSize, noIcons: !iconSize },
    );
    details.human_readable_age = user.timestamp
        ? timeago.format(new Date(user.timestamp as string))
        : null;

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
        // An app has no business reading the code its user earns credit with.
        delete details.referral_code;
    }

    const app = actor.effectiveApp;
    if (app) {
        details.app_name = app.uid;
    }

    // A key core left undefined isn't built, so a listener can't fill it for an app.
    const builtKeys = isUser
        ? null
        : new Set(
              Object.keys(details).filter((key) => details[key] !== undefined),
          );
    try {
        await clients.event.emitAndWait(
            'whoami.details',
            { user, details, isUser },
            {},
        );
    } catch {
        /* best-effort */
    }
    if (builtKeys) {
        for (const key of Object.keys(details)) {
            if (!builtKeys.has(key) && !APP_VISIBLE_LISTENER_KEYS.has(key)) {
                delete details[key];
            }
        }
    }

    const subscription = details.subscription as
        { offering?: Record<string, unknown> } | undefined;
    if (subscription?.offering) {
        delete subscription.offering.group;
        delete subscription.offering.benefits;
        delete subscription.offering.price_id;
    }

    // Last word on what ships, after every listener has had its say.
    scrubSensitive(details);

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
