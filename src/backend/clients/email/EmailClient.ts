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

import dedent from 'dedent';
import handlebars, { template } from 'handlebars';
import nodemailer from 'nodemailer';
import type { IConfig } from '../../types';
import { PuterClient } from '../types';
import {
    EMAIL_TEMPLATES,
    type EmailTemplate,
    type EmailTemplateName,
} from './templates';

/**
 * Attachment shape passed through to the underlying transport. Give either
 * `content` (held in memory) or `path` (a local file the transport streams on
 * its own, re-read for every message that carries it).
 */
export interface EmailAttachment {
    filename: string;
    content?: Buffer | string;
    path?: string;
    contentType?: string;
    encoding?: string;
    /** Content-ID of an inline part the html body references as `cid:`. */
    cid?: string;
    contentDisposition?: 'attachment' | 'inline';
}

/** Subset of the transport's send result callers may care about. */
export interface SentMessageInfo {
    messageId?: string;
    accepted?: string[];
    rejected?: string[];
    [key: string]: unknown;
}

export interface SendMailOptions {
    from?: string;
    to: string;
    cc?: string;
    bcc?: string;
    /** Optional transport recipients when they differ from visible headers. */
    envelope?: {
        from?: string;
        to: string;
    };
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    attachments?: EmailAttachment[];
    /** Extra message headers (e.g. List-Unsubscribe), passed to the transport. */
    headers?: Record<string, string>;
}

interface CompiledTemplate {
    subject: ReturnType<typeof template>;
    html: ReturnType<typeof template>;
    text?: ReturnType<typeof template>;
}

// -- EmailClient ------------------------------------------------------

/**
 * Unified email client. Handles:
 *
 * - Template-based outbound mail (via `send`)
 * - Raw nodemailer passthrough (via `sendRaw`)
 *
 * Address normalization and the domain blocklist live in `util/email.ts`.
 */
export class EmailClient extends PuterClient {
    private transport: ReturnType<typeof nodemailer.createTransport> | null =
        null;
    private compiledTemplates: Partial<
        Record<EmailTemplateName, CompiledTemplate>
    > = {};

    constructor(config: IConfig) {
        super(config);
        this.registerHandlebarsHelpers();
        this.compileTemplates();
    }

    // -- Lifecycle ----------------------------------------------------

    override onServerStart(): void {
        const emailConf = this.config.email;
        if (!emailConf) {
            console.warn(
                '[email] no email transport configured — send() will fail until configured',
            );
            return;
        }

        this.transport = nodemailer.createTransport(emailConf);
        console.log('[email] transport configured');
    }

    override onServerShutdown(): void {
        this.transport?.close?.();
        this.transport = null;
    }

    // -- Public API: sending ------------------------------------------

    /**
     * Render a template and send it to `to`. `options.replyTo` sets the
     * Reply-To header (e.g. so a recipient can respond to the originator of the
     * message rather than the no-reply From address).
     *
     * Returns the transport's send result, or `null` when none is configured —
     * {@link sendRaw} drops the message instead of throwing. A caller that
     * treats undelivered mail as a failure must check for `null` too.
     */
    async send<T extends EmailTemplateName>(
        to: string,
        template: T,
        values: Record<string, unknown> = {},
        options: { replyTo?: string } = {},
    ) {
        const compiled = this.compiledTemplates[template];
        if (!compiled) {
            throw new Error(`Unknown email template: ${template}`);
        }

        return await this.sendRaw({
            from: this.defaultFrom(),
            to,
            subject: compiled.subject(values),
            html: compiled.html(values),
            ...(compiled.text ? { text: compiled.text(values) } : {}),
            ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        });
    }

    /**
     * Raw send — bypasses the template system. Useful for one-off admin emails
     * that don't warrant a named template.
     *
     * Returns the transport's send result, or `null` when no transport is
     * configured (the send is a no-op in that case — callers that must not
     * silently drop mail should check `config.email` before composing, or the
     * `null` return after).
     */
    async sendRaw(options: SendMailOptions) {
        if (!this.transport) {
            console.warn(
                '[email] attempted to send email without transport. If you need to send email, configure an SMTP transport in your config file (see docs for details). Email content:',
                options,
            );
            return null;
        }
        return await this.transport.sendMail({
            ...options,
            from: options.from ?? this.defaultFrom(),
        });
    }

    // -- Internals ----------------------------------------------------

    private defaultFrom(): string {
        return this.config.email?.from ?? '"Puter" no-reply@puter.com';
    }

    private registerHandlebarsHelpers(): void {
        handlebars.registerHelper('nl2br', (text: unknown) => {
            if (text == null) return '';
            const escaped = String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            return new handlebars.SafeString(escaped.replace(/\n/g, '<br />'));
        });
    }

    private compileTemplates(): void {
        // Widened to the interface: the literal map keeps a distinct type per
        // template, and only some of them carry a `text` part.
        const templates: Record<EmailTemplateName, EmailTemplate> =
            EMAIL_TEMPLATES;
        for (const [name, template] of Object.entries(templates)) {
            this.compiledTemplates[name as EmailTemplateName] = {
                // Subjects are plain-text headers: HTML-escaping would put
                // literal entities in front of the recipient (&amp; etc.).
                // Header safety is handled elsewhere — the transport encodes
                // newlines, and free-form values (e.g. app_title) collapse
                // whitespace upstream.
                subject: handlebars.compile(template.subject, {
                    noEscape: true,
                }),
                html: handlebars.compile(dedent(template.html)),
                // Same reasoning as the subject: a text part is not HTML, so
                // escaping would show entities to the reader.
                ...(template.text
                    ? {
                          text: handlebars.compile(dedent(template.text), {
                              noEscape: true,
                          }),
                      }
                    : {}),
            };
        }
    }
}
