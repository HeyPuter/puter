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
import { BoundedTtlMap } from '../../util/boundedTtlMap';
import type { AlertDelivery, AlertHandler, AlertPayload } from './types';

const REQUEST_TIMEOUT_MS = 5000;
const SLACK_API = 'https://slack.com/api';
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
 * Render an alert as a message body (webhook or `chat.postMessage`):
 * severity-coloured attachment, the alarm's fields as a table, and the stack
 * (when there is one) as a code block.
 */
export function buildSlackMessage(
    alert: AlertPayload,
    opts: { channel?: string; username?: string; serverId?: string } = {},
): SlackMessage {
    const style = STYLE[alert.severity] ?? STYLE.info;
    const repeat = alert.isRepeat ? ` (x${alert.repeatCount})` : '';
    const call = alert.callGroup
        ? ` :telephone_receiver: calling \`${alert.callGroup}\``
        : '';
    const summary = alert.summary
        ?.replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const headline = summary
        ? `${style.emoji} ${summary}${repeat}${call}`
        : `${style.emoji} *[${alert.severity.toUpperCase()}]* ${alert.message}${repeat}${call}`;

    const fields: SlackField[] = [];
    for (const [key, value] of Object.entries(summary ? {} : alert.fields)) {
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

    const footerParts = summary ? [alert.shortId] : [alert.shortId, alert.id];
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

/** The channel an alert posts to: its key's mapping, else the default. */
export function resolveSlackChannel(
    conf: ISlackAlertConfig,
    key: string | undefined,
): string | undefined {
    const mapped =
        key && conf.channels && Object.hasOwn(conf.channels, key)
            ? conf.channels[key]
            : undefined;
    return mapped || conf.channel;
}

/**
 * Post alerts to Slack: through the Web API with a bot token, which can reach
 * any channel and link to the message, or else to an incoming webhook. Repeats
 * of the same alarm id are throttled so a hot loop doesn't flood the channel —
 * the occurrence count on the next post that gets through tells the reader what
 * they missed.
 */
export function createSlackAlertHandler(
    conf: ISlackAlertConfig,
    opts: { serverId?: string } = {},
): AlertHandler {
    const throttleMs = conf.repeatThrottleMs ?? DEFAULT_REPEAT_THROTTLE_MS;
    // A zero or negative throttle expires every entry on arrival.
    const lastPosted = new BoundedTtlMap<string, true>({
        maxEntries: MAX_THROTTLE_ENTRIES,
        ttlMs: throttleMs,
    });
    const post = conf.botToken
        ? postWithBot(conf.botToken)
        : postToWebhook(conf.webhookUrl as string);

    return async (alert) => {
        if (!lastPosted.shouldEmit(alert.id)) return;

        const message = buildSlackMessage(alert, {
            channel: resolveSlackChannel(conf, alert.channel),
            username: conf.username,
            serverId: opts.serverId,
        });
        try {
            return await post(message, alert);
        } catch (err) {
            // A rejected post shouldn't leave the id marked as delivered.
            lastPosted.delete(alert.id);
            throw err;
        }
    };
}

type SlackPost = (
    message: SlackMessage,
    alert: AlertPayload,
) => Promise<AlertDelivery | void>;

function postToWebhook(webhookUrl: string): SlackPost {
    return (message) =>
        slackFetch(
            webhookUrl,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(message),
            },
            async (res) => {
                if (!res.ok)
                    throw new Error(`Slack webhook returned ${res.status}`);
            },
        );
}

/** Only an alert that calls asks for its permalink; that's a second request. */
function postWithBot(token: string): SlackPost {
    const auth = { Authorization: `Bearer ${token}` };
    return async (message, alert) => {
        const posted = await slackApi<{ channel: string; ts: string }>(
            'chat.postMessage',
            {
                method: 'POST',
                headers: {
                    ...auth,
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify(message),
            },
        );
        if (!alert.callGroup) return {};

        const query = new URLSearchParams({
            channel: posted.channel,
            message_ts: posted.ts,
        });
        // The message is posted either way; a missing link must not repost it.
        try {
            const link = await slackApi<{ permalink: string }>(
                `chat.getPermalink?${query}`,
                { headers: auth },
            );
            return { url: link.permalink };
        } catch (err) {
            console.warn(
                `[alarm] Slack permalink lookup failed: ${(err as Error)?.message}`,
            );
            return {};
        }
    };
}

/** Web API methods answer 200 with `ok: false` on failure. */
function slackApi<T>(method: string, init: RequestInit): Promise<T> {
    return slackFetch(`${SLACK_API}/${method}`, init, async (res) => {
        if (!res.ok) throw new Error(`Slack ${method} returned ${res.status}`);
        const body = (await res.json()) as {
            ok?: boolean;
            error?: string;
        } & T;
        if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error}`);
        return body;
    });
}

/** The timeout covers `read` as well as the response headers. */
async function slackFetch<T>(
    url: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await read(
            await fetch(url, { ...init, signal: controller.signal }),
        );
    } finally {
        clearTimeout(timer);
    }
}
