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

export interface AlarmOptions {
    /**
     * Collapse repeats of this alarm id into a single incident on transports
     * that de-duplicate (PagerDuty). Only right when the id already pins down
     * one recurring fault — an uncaught error on a route, say — so that N
     * occurrences really are one thing to fix. Off by default: every other
     * alarm raises its own incident per occurrence.
     */
    dedup?: boolean;
    /**
     * Chat channel key naming the area that owns this alarm (`billing`,
     * `ai_providers`). Config maps keys to channels; an unmapped or absent key
     * posts to the default channel. Fixed by the alarm's first occurrence.
     */
    channel?: string;
}

export interface Alarm extends AlarmOptions {
    id: string;
    shortId: string;
    message: string;
    fields: AlarmFields;
    error?: Error;
    started: number;
    /** Every occurrence counted since the alarm started. */
    count: number;
    /** When the latest occurrence was recorded, epoch ms. */
    lastSeen: number;
    severity?: PagerSeverity;
    /** Set once a config mute has been logged, so it's reported only once. */
    muteLogged?: boolean;
    /** The last call raised, so repeats too frequent to report keep it open. */
    call?: AlarmCall;
    /** When `call` was last handed to the call handlers, epoch ms. */
    callAt?: number;
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
    /** Chat channel key from {@link AlarmOptions.channel}. */
    channel?: string;
    /** Call group config assigned this alarm, when it phones someone. */
    callGroup?: string;
    /** PagerDuty `custom_details` payload. */
    custom?: Record<string, unknown>;
}

/** What a transport reports about an alert it delivered. */
export interface AlertDelivery {
    /** Link to the delivered alert, such as the chat message it became. */
    url?: string;
}

export type AlertHandler = (
    alert: AlertPayload,
) => Promise<AlertDelivery | void>;

/** An alarm that config says phones someone, once its transports settled. */
export interface AlarmCall {
    group: string;
    alert: AlertPayload;
    /** Where a responder can read the alarm; empty when no transport linked. */
    links: string[];
}

export type CallHandler = (call: AlarmCall) => Promise<void>;
