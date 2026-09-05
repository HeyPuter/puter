/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { createHash, createHmac } from 'node:crypto';

/**
 * How an app's events worker is named and how it recognizes the platform.
 *
 * The script is named after the handler set it contains, so a changed set is a
 * different script rather than an overwrite of a live one: publishing writes
 * rows and nothing else, and whatever the rows currently hash to is what the
 * next delivery resolves and deploys. Superseded scripts are left to the same
 * idle eviction every hibernating worker gets.
 */

/** Prefix every events worker script carries, for tag-free identification. */
export const EVENTS_WORKER_PREFIX = 'evw-';

/**
 * The worker session name a delivery's token is minted under. One session row
 * per (user, app) is reused across every delivery to that app's handlers, so it
 * shows up once in the user's sessions list and is revoked the same way any
 * worker session is.
 */
// Contains `:`, which WORKER_NAME_REGEX forbids a user-created worker name
// from having — so this session can never collide with an ordinary
// `puter.workers.*` session under the same (user, app_uid) key.
export const EVENTS_WORKER_SESSION_NAME = 'events:handlers';

/**
 * What scopes a script name to one backend. Two backends can share a dispatch
 * namespace and database (staging and production, say); folding this into the
 * name is what keeps a script deployed by one from resolving as the other's.
 * The same value `#cfDeploy` binds a script's `puter_endpoint` as, so a script
 * is always scoped to the backend whose requests it would actually answer.
 */
export const eventsWorkerScope = (config: {
    workers?: { internetExposedUrl?: string };
}): string => config.workers?.internetExposedUrl ?? '';

/**
 * The script a handler set deploys as, scoped to this backend. Truncated hash:
 * long enough that two sets never collide, short enough to leave room in a
 * script name.
 */
export const eventsWorkerScript = (setHash: string, scope: string): string =>
    `${EVENTS_WORKER_PREFIX}${createHash('sha256')
        .update(`${scope}\n${setHash}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`;

/** Version prefix on a derived key, so a rotation is visible in a log line. */
export const EVENTS_INVOKE_KEY_VERSION = 'k1';

/**
 * The key an invocation carries and the script compares against its own
 * binding. Derived from the deployment secret and the script name rather than
 * stored, so there is no per-worker row to keep, and rotating the secret
 * rotates every key at the next deploy.
 *
 * Defence in depth behind the dispatcher: reaching a script at all needs the
 * internal secret, which no script ever sees.
 */
export const eventsInvokeKey = (secret: string, script: string): string =>
    `${EVENTS_INVOKE_KEY_VERSION}:${createHmac('sha256', secret)
        .update(`events-invoke:${script}`, 'utf8')
        .digest('hex')}`;
