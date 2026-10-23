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

import {
    forwardTarget,
    type EventForwardService,
} from '../events/EventForwardService.js';
import type { SocketService } from '../socket/SocketService.js';

export interface PushPresenceDeps {
    socket: Pick<SocketService, 'has'>;
    eventForward: Pick<
        EventForwardService,
        'active' | 'heldInRegion' | 'regionsFor'
    >;
}

/** This node's sockets only; no I/O. */
export const isConnectedHere = (
    socket: PushPresenceDeps['socket'],
    userId: number,
    appUid: string | null,
): boolean => socket.has(forwardTarget(userId, appUid));

/** Other nodes and regions count only where presence is kept (peers set). */
export const isUserConnected = async (
    deps: PushPresenceDeps,
    userId: number,
    appUid: string | null,
): Promise<boolean> => {
    if (isConnectedHere(deps.socket, userId, appUid)) return true;
    if (!deps.eventForward.active) return false;
    try {
        if (await deps.eventForward.heldInRegion(userId, appUid)) return true;
        return (await deps.eventForward.regionsFor(userId, appUid)).length > 0;
    } catch (err) {
        console.warn('[push] presence read failed', err);
        return false;
    }
};
