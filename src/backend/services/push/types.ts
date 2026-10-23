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

import type { PushPlatform } from '../../stores/push/PushDeviceStore.js';

export type { PushPlatform };

/** Where a tap leads, read by Puter's own client. No app means the desktop. */
export interface PushTarget {
    /** App name. */
    app?: string;
    path?: string;
}

/** One push, independent of the provider that carries it. */
export interface PushMessage {
    /** The notification's uid. */
    uid: string;
    title: string;
    body?: string;
    icon?: string;
    /** A later push with the same group replaces this one on the device. */
    group: string;
    target?: PushTarget;
    data?: unknown;
    /** Seconds a provider may hold it for an offline device. */
    ttl: number;
    priority: 'normal';
    /** Content was withheld; the provider should not add any of its own. */
    sensitive?: boolean;
}

export type PushResult =
    | { status: 'delivered' }
    /** The provider says the token no longer names a device. */
    | { status: 'unregistered' }
    | { status: 'failed'; reason?: string };

export interface PushBatch {
    platform: PushPlatform;
    tokens: string[];
    message: PushMessage;
}

/** `send` resolves one result per token, in the same order. */
export interface PushProvider {
    platforms: readonly PushPlatform[];
    send(batch: PushBatch): Promise<PushResult[]>;
}
