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

import { event as pdEvent } from '@pagerduty/pdjs';
import type { AlertHandler } from './types';

const PAGERDUTY_API = 'https://api.pagerduty.com';
const REQUEST_TIMEOUT_MS = 5000;
/** PagerDuty opens the incident a moment after it accepts the event. */
const INCIDENT_LOOKUP_DELAYS_MS = [1000, 2000, 4000];

/**
 * Trigger a PagerDuty event per alert. An alert that calls also looks up the
 * incident it opened, with a REST `apiToken`, so the call can link to it.
 */
export function createPagerDutyAlertHandler(conf: {
    routingKey: string;
    apiToken?: string;
    serverId?: string;
}): AlertHandler {
    return async (alert) => {
        await pdEvent({
            data: {
                routing_key: conf.routingKey,
                event_action: 'trigger',
                dedup_key: alert.dedupKey,
                payload: {
                    summary: alert.message,
                    source: alert.source,
                    severity: alert.severity,
                    custom_details: {
                        ...alert.custom,
                        server_id: conf.serverId,
                    },
                },
            },
        });
        if (!alert.callGroup || !conf.apiToken) return;

        const url = await findIncidentUrl(conf.apiToken, alert.dedupKey);
        return url ? { url } : undefined;
    };
}

/**
 * The open incident for a dedup key, retried while PagerDuty creates it. The
 * event is already sent, so a failed lookup only costs the call its link.
 */
async function findIncidentUrl(
    apiToken: string,
    dedupKey: string,
): Promise<string | undefined> {
    for (const delay of INCIDENT_LOOKUP_DELAYS_MS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
            const url = await openIncidentUrl(apiToken, dedupKey);
            if (url) return url;
        } catch (err) {
            console.warn(
                `[alarm] PagerDuty incident lookup failed: ${(err as Error)?.message}`,
            );
            return undefined;
        }
    }
    return undefined;
}

async function openIncidentUrl(
    apiToken: string,
    dedupKey: string,
): Promise<string | undefined> {
    const query = new URLSearchParams({
        incident_key: dedupKey,
        sort_by: 'created_at:desc',
    });
    query.append('statuses[]', 'triggered');
    query.append('statuses[]', 'acknowledged');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${PAGERDUTY_API}/incidents?${query}`, {
            headers: {
                Authorization: `Token token=${apiToken}`,
                Accept: 'application/vnd.pagerduty+json;version=2',
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            throw new Error(`PagerDuty incidents returned ${res.status}`);
        }
        const body = (await res.json()) as {
            incidents?: Array<{ html_url?: string }>;
        };
        return body.incidents?.[0]?.html_url;
    } finally {
        clearTimeout(timer);
    }
}
