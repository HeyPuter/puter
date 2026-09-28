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

import http from 'node:http';
import https from 'node:https';
import PostalMime from 'postal-mime';
import { MAIL_CONTENT_TYPE } from '../services/email/mailbox.js';

/**
 * An SMTP reply: 250 when the endpoint took the message, an error code
 * otherwise.
 */
export interface SmtpReply {
    code: number;
    text: string;
}

export const ACCEPTED: SmtpReply = {
    code: 250,
    text: '2.0.0 Message accepted',
};

export interface IngressTarget {
    url: string;
    /** Sent as the Host header: the endpoint is served on the api subdomain. */
    host?: string | null;
    secret: string;
    timeoutMs: number;
}

/**
 * Header fields the endpoint takes in its query string. Fallbacks match what
 * the hosted receiver sends, so a message looks the same whichever one
 * delivered it.
 */
export const readHeaderFields = async (message: Buffer) => {
    try {
        const parsed = await PostalMime.parse(message);
        return {
            subject: parsed.subject ?? '',
            from: parsed.from?.address ?? 'anonymous@example.com',
            messageId: parsed.messageId ?? 'NO-ID',
        };
    } catch {
        // A message we cannot parse is still a message we can deliver.
        return {
            subject: '',
            from: 'anonymous@example.com',
            messageId: 'NO-ID',
        };
    }
};

export const buildIngressUrl = (
    base: string,
    params: {
        to: string;
        subject: string;
        from: string;
        messageId: string;
        secret: string;
    },
): URL => {
    const url = new URL(base);
    url.searchParams.set('subject', params.subject);
    url.searchParams.set('messageid', params.messageId);
    url.searchParams.set('from', params.from);
    url.searchParams.set('to', params.to);
    url.searchParams.set('SECRET', params.secret);
    return url;
};

/**
 * The endpoint without its query string. The secret travels as a query
 * parameter, so the full URL is a credential and only this form may be logged.
 */
export const describeTarget = (base: string): string => {
    try {
        const url = new URL(base);
        return `${url.origin}${url.pathname}`;
    } catch {
        return '<invalid ingress url>';
    }
};

/**
 * Anything other than "stored" and "no such user" is reported as temporary, so
 * the sending server retries rather than bouncing mail over a problem at this
 * end - a wrong secret included.
 */
export const replyForStatus = (status: number): SmtpReply => {
    if (status >= 200 && status < 300) return ACCEPTED;
    if (status === 404) return { code: 550, text: '5.1.1 No such user here' };
    if (status === 413)
        return { code: 552, text: '5.3.4 Message too big for system' };
    return { code: 451, text: '4.3.0 Temporary server error' };
};

/** Hand one message to the ingress endpoint for one recipient. */
export const deliver = async (
    message: Buffer,
    recipient: string,
    fields: { subject: string; from: string; messageId: string },
    target: IngressTarget,
): Promise<SmtpReply> => {
    const url = buildIngressUrl(target.url, {
        to: recipient,
        ...fields,
        secret: target.secret,
    });
    const transport = url.protocol === 'https:' ? https : http;

    return await new Promise<SmtpReply>((resolve) => {
        const req = transport.request(
            url,
            {
                method: 'POST',
                headers: {
                    'content-type': MAIL_CONTENT_TYPE,
                    // Required: the endpoint refuses a body of unknown length.
                    'content-length': String(message.byteLength),
                    ...(target.host ? { host: target.host } : {}),
                },
                timeout: target.timeoutMs,
            },
            (res) => {
                res.resume();
                res.once('end', () =>
                    resolve(replyForStatus(res.statusCode ?? 0)),
                );
            },
        );
        // Errors from the HTTP client can carry the request URL, and that URL
        // holds the secret, so none of it is surfaced.
        req.once('error', () =>
            resolve({ code: 451, text: '4.4.1 Ingress unavailable' }),
        );
        req.once('timeout', () => {
            req.destroy();
            resolve({ code: 451, text: '4.4.2 Ingress timed out' });
        });
        req.end(message);
    });
};
