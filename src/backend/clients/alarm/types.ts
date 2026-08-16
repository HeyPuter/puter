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

import type { PagerSeverity } from '../../types';

export interface AlarmFields {
    error?: Error;
    [key: string]: unknown;
}

export interface AlarmOccurrence {
    message: string;
    fields: AlarmFields;
    timestamp: number;
}

export interface AlarmOptions {
    /**
     * Collapse repeats of this alarm id into a single incident on transports
     * that de-duplicate (PagerDuty). Only right when the id already pins down
     * one recurring fault — an uncaught error on a route, say — so that N
     * occurrences really are one thing to fix. Off by default: every other
     * alarm raises its own incident per occurrence.
     */
    dedup?: boolean;
}

export interface Alarm extends AlarmOptions {
    id: string;
    shortId: string;
    message: string;
    fields: AlarmFields;
    error?: Error;
    started: number;
    /**
     * Every occurrence ever counted, including those aged out of the two lists
     * below.
     */
    count: number;
    /**
     * Timestamps of the most recent occurrences only — see
     * `OCCURRENCE_HISTORY_LIMIT`.
     */
    timestamps: number[];
    /** The most recent occurrences only — see `OCCURRENCE_HISTORY_LIMIT`. */
    occurrences: AlarmOccurrence[];
    severity?: PagerSeverity;
    noAlert?: boolean;
    /** Set once a config mute has been logged, so it's reported only once. */
    muteLogged?: boolean;
}

export interface AlertPayload {
    id: string;
    /**
     * Key a de-duplicating transport groups by. Equal to `id` for alarms raised
     * with `dedup`, and unique per occurrence for everything else.
     */
    dedupKey: string;
    /** Readable slug for the same alarm, for humans quoting it back. */
    shortId: string;
    message: string;
    source: string;
    severity: PagerSeverity;
    /** Field values rendered as strings, ready to display. */
    fields: Record<string, string>;
    /** Stack of the attached error, when the alarm carried one. */
    trace?: string;
    /** Total occurrences of this alarm so far, including this one. */
    repeatCount: number;
    /** False for the first occurrence of an alarm id. */
    isRepeat: boolean;
    /** PagerDuty `custom_details` payload. */
    custom?: Record<string, unknown>;
}

export type AlertHandler = (alert: AlertPayload) => Promise<void>;

export interface KnownErrorRule {
    match: {
        id: string;
        message?: string;
        fields?: Record<string, unknown>;
    };
    action: {
        type: 'no-alert' | 'severity';
        value?: PagerSeverity;
    };
}
