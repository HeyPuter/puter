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

// What one job run needs, whichever scheduler holds the job. Also used by
// extensions that replace `services.jobs`.

import type { JobDefinition } from './JobScheduler.js';

export const JOB_STATE_MAX_BYTES = 64 * 1024;
export const JOB_ERROR_MAX_CHARS = 1024;

/** The run no longer holds its job; another node may already be running it. */
export class JobLeaseLostError extends Error {}

export type RegisteredJob = Required<JobDefinition>;

export type RunOutcome = 'success' | 'failure' | 'interrupted';

/** What a run holds the job by. Its deadline is measured from before the claim. */
export interface RunLease {
    controller: AbortController;
    /**
     * Renews if little lease is left; false (and aborted) if the run can't
     * start.
     */
    ready: () => Promise<boolean>;
    close: () => void;
}

export const lostLease = (lease: RunLease, name: string): never => {
    const lost = new JobLeaseLostError(`job ${name} lost its lease`);
    lease.controller.abort(lost);
    throw lost;
};

/** A run cut short by its signal is interrupted, whether or not it threw. */
export const runOutcome = (signal: AbortSignal, error: unknown): RunOutcome => {
    if (signal.aborted) return 'interrupted';
    return error === null ? 'success' : 'failure';
};

export const parseState = (raw: string | null): unknown => {
    if (raw === null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

export const serializeState = (state: unknown): string => {
    const json = JSON.stringify(state ?? null);
    if (Buffer.byteLength(json) > JOB_STATE_MAX_BYTES) {
        throw new Error(`job state is over ${JOB_STATE_MAX_BYTES} bytes`);
    }
    return json;
};

export const asError = (error: unknown): Error =>
    error instanceof Error ? error : new Error(String(error));

export const errorText = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error)).slice(
        0,
        JOB_ERROR_MAX_CHARS,
    );
