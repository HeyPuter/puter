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

import { MAX_MESSAGE_BYTES } from '../services/email/mailbox.js';
import type { IConfig } from '../types';

export interface ResolvedSmtpConfig {
    host: string;
    port: number;
    hostname: string;
    domains: string[];
    ingressUrl: string;
    /** Host header override; the ingress route is gated on the api subdomain. */
    ingressHost: string | null;
    secret: string;
    maxMessageBytes: number;
    maxRecipients: number;
    maxClients: number;
}

export class SmtpConfigError extends Error {
    constructor(public readonly problems: string[]) {
        super(`invalid userEmail receiver config:\n- ${problems.join('\n- ')}`);
        this.name = 'SmtpConfigError';
    }
}

/** Whether the local receiver is switched on at all. */
export const isLocalServerEnabled = (config: IConfig): boolean =>
    config.userEmail?.localServer === true;

/**
 * Apply defaults and refuse an unusable configuration, naming every problem at
 * once. A listener that starts and then rejects every message is harder to
 * diagnose than one that will not start.
 */
export const resolveSmtpConfig = (config: IConfig): ResolvedSmtpConfig => {
    const cfg = config.userEmail ?? {};
    const problems: string[] = [];

    const secret = typeof cfg.secret === 'string' ? cfg.secret : '';
    if (!secret) problems.push('userEmail.secret must be set');

    const domains = Array.isArray(cfg.localDomains)
        ? cfg.localDomains
              .filter((d): d is string => typeof d === 'string' && d.length > 0)
              .map((d) => d.toLowerCase())
        : [];
    if (domains.length === 0) {
        problems.push(
            'userEmail.localDomains must list at least one domain to accept mail for',
        );
    }

    const ingressUrl =
        cfg.localIngressUrl ||
        (config.api_base_url
            ? `${config.api_base_url.replace(/\/$/, '')}/email/ingress`
            : '');
    if (!ingressUrl) {
        problems.push(
            'userEmail.localIngressUrl must be set when api_base_url is not configured',
        );
    } else {
        try {
            new URL(ingressUrl);
        } catch {
            problems.push('userEmail.localIngressUrl must be an absolute URL');
        }
    }

    const port = cfg.localPort ?? 2525;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        problems.push('userEmail.localPort must be a port number');
    }

    // The ingress route is served on the api subdomain, so a URL pointing at an
    // internal address still has to address that virtual host by name.
    let ingressHost = cfg.localIngressHost ?? null;
    if (!ingressHost && config.api_base_url) {
        try {
            ingressHost = new URL(config.api_base_url).host;
        } catch {
            ingressHost = null;
        }
    }

    if (problems.length > 0) throw new SmtpConfigError(problems);

    return {
        host: cfg.localHost ?? '0.0.0.0',
        port,
        hostname: cfg.localHostname ?? domains[0],
        domains,
        ingressUrl,
        ingressHost,
        secret,
        maxMessageBytes: MAX_MESSAGE_BYTES,
        maxRecipients: cfg.localMaxRecipients ?? 50,
        // Bounds concurrent messages, and so memory, since each is held whole.
        maxClients: cfg.localMaxClients ?? 20,
    };
};
