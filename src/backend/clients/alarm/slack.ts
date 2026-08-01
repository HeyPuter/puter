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

import type { ISlackAlertConfig, PagerSeverity } from '../../types';
import type { AlertHandler, AlertPayload } from './types';

const REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_REPEAT_THROTTLE_MS = 15 * 60 * 1000;

/** Beyond this many tracked alarm ids, throttle state is pruned. */
const MAX_THROTTLE_ENTRIES = 5000;

const MAX_FIELDS = 12;
const MAX_FIELD_VALUE = 400;
const MAX_TRACE = 1500;
/** Values under this length sit two-per-row in the Slack attachment. */
const SHORT_FIELD_LENGTH = 40;

const STYLE: Record<PagerSeverity, { emoji: string; color: string }> = {
    critical: { emoji: ':rotating_light:', color: '#d64545' },
    error: { emoji: ':red_circle:', color: '#e08d4c' },
    warning: { emoji: ':warning:', color: '#e0b84c' },
    info: { emoji: ':information_source:', color: '#4c8de0' },
};

interface SlackField {
    title: string;
    value: string;
    short: boolean;
}

export interface SlackMessage {
    text: string;
    channel?: string;
    username?: string;
    icon_emoji?: string;
    attachments: Array<{
        color: string;
        fallback: string;
        fields: SlackField[];
        footer: string;
        mrkdwn_in: string[];
        text?: string;
    }>;
}

function truncate(value: string, max: number): string {
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Render an alert as an incoming-webhook payload: severity-coloured attachment,
 * the alarm's fields as a table, and the stack (when there is one) as a code
 * block. Split out from the handler so the formatting is testable on its own.
 */
export function buildSlackMessage(
    alert: AlertPayload,
    opts: { channel?: string; username?: string; serverId?: string } = {},
): SlackMessage {
    const style = STYLE[alert.severity] ?? STYLE.info;
    const repeat = alert.isRepeat ? ` (x${alert.repeatCount})` : '';
    const headline = `${style.emoji} *[${alert.severity.toUpperCase()}]* ${alert.message}${repeat}`;

    const fields: SlackField[] = [];
    for (const [key, value] of Object.entries(alert.fields)) {
        if (fields.length >= MAX_FIELDS) break;
        // `error` is already rendered as the trace block below.
        if (key === 'error') continue;
        const rendered = truncate(value, MAX_FIELD_VALUE);
        fields.push({
            title: key,
            value: rendered,
            short: rendered.length <= SHORT_FIELD_LENGTH,
        });
    }

    const footerParts = [alert.shortId, alert.id];
    if (opts.serverId) footerParts.push(opts.serverId);

    return {
        text: headline,
        ...(opts.channel ? { channel: opts.channel } : {}),
        ...(opts.username ? { username: opts.username } : {}),
        attachments: [
            {
                color: style.color,
                fallback: `[${alert.severity}] ${alert.message}`,
                fields,
                footer: footerParts.join(' • '),
                mrkdwn_in: ['text'],
                ...(alert.trace
                    ? { text: '```' + truncate(alert.trace, MAX_TRACE) + '```' }
                    : {}),
            },
        ],
    };
}

/**
 * Post alerts to a Slack incoming webhook. Repeats of the same alarm id are
 * throttled so a hot loop doesn't flood the channel — the occurrence count on
 * the next post that gets through tells the reader what they missed.
 */
export function createSlackAlertHandler(
    conf: ISlackAlertConfig,
    opts: { serverId?: string } = {},
): AlertHandler {
    const webhookUrl = conf.webhookUrl as string;
    const throttleMs = conf.repeatThrottleMs ?? DEFAULT_REPEAT_THROTTLE_MS;
    const lastPosted = new Map<string, number>();

    const shouldPost = (alert: AlertPayload): boolean => {
        if (throttleMs <= 0) return true;
        const now = Date.now();
        const previous = lastPosted.get(alert.id);
        if (previous !== undefined && now - previous < throttleMs) return false;

        if (lastPosted.size >= MAX_THROTTLE_ENTRIES) {
            for (const [id, at] of lastPosted) {
                if (now - at >= throttleMs) lastPosted.delete(id);
            }
            // Still full of live entries — drop the oldest to stay bounded.
            if (lastPosted.size >= MAX_THROTTLE_ENTRIES) {
                const oldest = lastPosted.keys().next().value;
                if (oldest !== undefined) lastPosted.delete(oldest);
            }
        }
        lastPosted.set(alert.id, now);
        return true;
    };

    return async (alert) => {
        if (!shouldPost(alert)) return;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const res = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(
                    buildSlackMessage(alert, {
                        channel: conf.channel,
                        username: conf.username,
                        serverId: opts.serverId,
                    }),
                ),
                signal: controller.signal,
            });
            if (!res.ok) {
                // A rejected post shouldn't leave the id marked as delivered.
                lastPosted.delete(alert.id);
                throw new Error(`Slack webhook returned ${res.status}`);
            }
        } catch (err) {
            lastPosted.delete(alert.id);
            throw err;
        } finally {
            clearTimeout(timer);
        }
    };
}
