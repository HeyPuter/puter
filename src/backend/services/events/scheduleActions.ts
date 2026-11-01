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

/**
 * In-process actions a `deferred` schedule runs when it comes due, in place of
 * an app's handler. The action owns its row's claim and finish in SQL; the
 * runner owns the index and tells the action how the attempt stands.
 */

export interface ScheduleActionRun {
    scheduleId: string;
    rowId: number;
    holderUserId: number;
    appUid: string;
    scheduledFor: number;
    /** Attempts at this slot before this one. */
    attempts: number;
    /** Aborted when the attempt's lease is lost. */
    signal: AbortSignal;
}

/**
 * `finished`: the row is ended in SQL at `version`. `retry`: try again after a
 * backoff, counting an attempt. `defer`: try again after `delayMs` without
 * one.
 */
export type ScheduleActionOutcome =
    | { type: 'finished'; version: number }
    | { type: 'retry'; delayMs?: number }
    | { type: 'defer'; delayMs: number };

export type ScheduleAction = (
    run: ScheduleActionRun,
) => Promise<ScheduleActionOutcome>;

export class ScheduleActionRegistry {
    readonly #actions = new Map<string, ScheduleAction>();

    register(name: string, action: ScheduleAction): void {
        if (this.#actions.has(name))
            throw new Error(`schedule action ${name} is already registered`);
        this.#actions.set(name, action);
    }

    get(name: string | null): ScheduleAction | null {
        return name === null ? null : (this.#actions.get(name) ?? null);
    }
}
