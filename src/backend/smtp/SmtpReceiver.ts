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

import { SMTPServer } from 'smtp-server';
import type { SMTPServerSession } from 'smtp-server';
import type { ResolvedSmtpConfig } from './config.js';
import {
    ACCEPTED,
    type SmtpReply,
    deliver,
    describeTarget,
    readHeaderFields,
} from './ingressClient.js';
import { acceptedRecipients } from './recipients.js';

const SOCKET_TIMEOUT_MS = 60_000;
const INGRESS_TIMEOUT_MS = 120_000;

const replyError = (reply: SmtpReply): Error =>
    Object.assign(new Error(reply.text), { responseCode: reply.code });

/**
 * An SMTP listener that hands each message to the mail ingress endpoint over
 * HTTP. It stores nothing and never relays: the only addresses it accepts are
 * in a configured domain, and the only place a message goes is that endpoint.
 *
 * Messages are held in memory while they are delivered, which is why
 * `maxClients` matters - it bounds concurrent messages, and so memory, at
 * roughly `maxClients` x the 25MiB message ceiling.
 */
export class SmtpReceiver {
    readonly #server: SMTPServer;

    constructor(private readonly cfg: ResolvedSmtpConfig) {
        this.#server = new SMTPServer({
            name: cfg.hostname,
            // Advertises SIZE, so an oversized message is refused at MAIL FROM
            // rather than after it has crossed the wire.
            size: cfg.maxMessageBytes,
            // Mail arriving from the internet authenticates nobody; the gate is
            // the accepted-domain check below.
            disabledCommands: ['AUTH'],
            authOptional: true,
            hideSTARTTLS: true,
            maxClients: cfg.maxClients,
            socketTimeout: SOCKET_TIMEOUT_MS,
            disableReverseLookup: true,
            logger: false,
            onRcptTo: (address, session, callback) => {
                const [recipient] = acceptedRecipients(
                    [address.address],
                    cfg.domains,
                );
                if (!recipient) {
                    // Refusing every other domain is what keeps this from being
                    // an open relay.
                    callback(
                        replyError({
                            code: 550,
                            text: '5.7.1 Relay access denied',
                        }),
                    );
                    return;
                }
                if (session.envelope.rcptTo.length >= cfg.maxRecipients) {
                    callback(
                        replyError({
                            code: 452,
                            text: '4.5.3 Too many recipients',
                        }),
                    );
                    return;
                }
                callback();
            },
            onData: (stream, session, callback) => {
                this.#handle(stream, session)
                    .then((reply) =>
                        callback(reply.code === 250 ? null : replyError(reply)),
                    )
                    .catch(() =>
                        callback(
                            replyError({
                                code: 451,
                                text: '4.3.0 Temporary server error',
                            }),
                        ),
                    );
            },
        });
    }

    async #handle(
        stream: NodeJS.ReadableStream & { sizeExceeded?: boolean },
        session: SMTPServerSession,
    ): Promise<SmtpReply> {
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk as Buffer);
        if (stream.sizeExceeded) {
            return { code: 552, text: '5.3.4 Message too big for system' };
        }
        const message = Buffer.concat(chunks);

        const fields = await readHeaderFields(message);
        // The envelope recipient, not the To: header - a blind-copied address
        // never appears in the header at all.
        const recipients = acceptedRecipients(
            session.envelope.rcptTo.map((r) => r.address),
            this.cfg.domains,
        );

        for (const recipient of recipients) {
            const reply = await deliver(message, recipient, fields, {
                url: this.cfg.ingressUrl,
                host: this.cfg.ingressHost,
                secret: this.cfg.secret,
                timeoutMs: INGRESS_TIMEOUT_MS,
            });
            if (reply.code !== 250) {
                // One reply covers the whole message, so the first failure is
                // what the sender is told.
                console.warn('[smtp] delivery refused', {
                    session: session.id,
                    recipient,
                    code: reply.code,
                    // Never the full URL: the secret is in its query string.
                    ingress: describeTarget(this.cfg.ingressUrl),
                });
                return reply;
            }
        }
        return ACCEPTED;
    }

    async listen(): Promise<{ port: number }> {
        await new Promise<void>((resolve, reject) => {
            this.#server.once('error', reject);
            this.#server.listen(this.cfg.port, this.cfg.host, () => {
                this.#server.off('error', reject);
                resolve();
            });
        });
        const address = this.#server.server.address();
        return {
            port: typeof address === 'object' && address ? address.port : 0,
        };
    }

    async close(): Promise<void> {
        await new Promise<void>((resolve) => this.#server.close(resolve));
    }
}
