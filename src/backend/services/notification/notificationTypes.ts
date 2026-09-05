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

/** Who the recipient is in relation to the notification. */
export type NotificationAudience = 'account' | 'developer' | 'app-user';

/** What a subject is built from: the recipient, and the app the row is about. */
export interface NotificationSubjectRef {
    userUuid: string;
    appUid: string | null;
}

export interface NotificationType {
    /** Stable wire name, stored in `notification`.`type`. */
    type: string;
    audience: NotificationAudience;
    /**
     * Whether a row of this type must name an app. `account` types never may; a
     * `developer` type that is not app-scoped still carries one where the app
     * is known.
     */
    appScoped: boolean;
    /** Whether `notifyUpdate` may fold a later one into an open row. */
    groupable: boolean;
    /** Where a delivery of this type publishes. */
    subject: (ref: NotificationSubjectRef) => string;
}

/**
 * `notif:<appUid>:<audience>`, falling back to the recipient when the row names
 * no app — which is every `account` row, and the worker rows whose app is
 * optional.
 */
const subjectFor =
    (audience: NotificationAudience) =>
    (ref: NotificationSubjectRef): string =>
        `notif:${ref.appUid ?? ref.userUuid}:${audience}`;

/**
 * The catalog. Every write goes through it, so a type that is not here cannot
 * reach the table.
 *
 * `audience` is not derivable from `app_uid`: "your worker failed to deploy"
 * and "your background job finished" both name an app, but the first must never
 * reach a _user_ of that app.
 */
export const NOTIFICATION_TYPES = [
    {
        type: 'share.received',
        audience: 'account',
        appScoped: false,
        groupable: true,
        subject: subjectFor('account'),
    },
    {
        type: 'share.claimed',
        audience: 'account',
        appScoped: false,
        groupable: false,
        subject: subjectFor('account'),
    },
    // A worker need not be bound to an app — `#resolveWorkerAppBinding`
    // returns null for a user-scoped one — so these carry an app only when
    // there is one to carry.
    {
        type: 'app.worker.deployed',
        audience: 'developer',
        appScoped: false,
        groupable: false,
        subject: subjectFor('developer'),
    },
    {
        type: 'app.worker.deployFailed',
        audience: 'developer',
        appScoped: false,
        groupable: false,
        subject: subjectFor('developer'),
    },
    // The recipient is the subscription's holder, not the app's owner: a
    // subscription that ended without an unsubscribe is news for whoever made
    // it. An account made its own carries no app, exactly as a worker row does.
    {
        type: 'app.events.ended',
        audience: 'app-user',
        appScoped: false,
        groupable: false,
        subject: subjectFor('app-user'),
    },
    {
        type: 'app.events.suspended',
        audience: 'developer',
        appScoped: true,
        groupable: false,
        subject: subjectFor('developer'),
    },
] as const satisfies readonly NotificationType[];

/** Every registered type name; what `notify` accepts. */
export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number]['type'];

/** Serialized `value` may not exceed this many bytes. */
export const NOTIFICATION_VALUE_MAX_BYTES = 16 * 1024;

const BY_NAME = new Map<string, NotificationType>(
    NOTIFICATION_TYPES.map((entry) => [entry.type, entry]),
);

export const findNotificationType = (
    type: string,
): NotificationType | undefined => BY_NAME.get(type);

/**
 * The registry entry for a write, or a throw. `account` rows never name an app;
 * app-scoped rows always do.
 */
export const resolveNotificationWrite = (
    type: string,
    appUid: string | null,
): NotificationType => {
    const entry = BY_NAME.get(type);
    if (!entry) {
        throw new Error(`notification type is not registered: ${type}`);
    }
    if (entry.audience === 'account' && appUid !== null) {
        throw new Error(
            `notification type ${type} is account-audience and cannot name an app`,
        );
    }
    if (entry.appScoped && !appUid) {
        throw new Error(`notification type ${type} requires an app uid`);
    }
    return entry;
};
