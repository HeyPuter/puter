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

import { AsyncLocalStorage } from 'node:async_hooks';

export const REDIS_UNAVAILABLE_MESSAGE = 'Redis unavailable';

/** True for the rejection of a command that got no reply within the timeout. */
export const isCommandTimeout = (error: unknown): boolean =>
    error instanceof Error && error.message === 'Command timed out';

/** True for a command rejected unsent while Redis is failing fast. */
export const isRedisUnavailable = (error: unknown): boolean =>
    error instanceof Error && error.message === REDIS_UNAVAILABLE_MESSAGE;

const undoScope = new AsyncLocalStorage<true>();

/** Sends the commands `send` issues past fail-fast, still timed and queued. */
export const sendAsUndo = <T>(send: () => T): T => undoScope.run(true, send);

export const isSendingUndo = (): boolean => undoScope.getStore() === true;
