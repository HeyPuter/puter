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

/**
 * Email template definitions. Keys are the template names; values are the
 * Handlebars-compilable `subject` and `html` strings.
 *
 * Rendered values are supplied by callers of `EmailClient.send()`. Variables
 * use standard Handlebars syntax: `{{var}}`, `{{#if cond}}…{{/if}}`, and the
 * custom helper `{{{nl2br text}}}` for HTML-safe newline conversion.
 */

export interface EmailTemplate {
    subject: string;
    html: string;
    /**
     * Optional plain-text alternative. Where a template has one it goes out
     * beside the HTML as multipart/alternative, which is what plain-text
     * clients, screen readers and spam scoring all prefer to a machine
     * down-conversion of the markup.
     */
    text?: string;
}

// -- Shared layout ----------------------------------------------------

/**
 * Colors, in one place so the two share templates can't drift apart. Every one
 * of them is also written inline further down: clients that drop `<style>`
 * (Gmail reading a non-Gmail account, Outlook.com) would otherwise render an
 * unstyled page, so the stylesheet only carries what inline CSS can't express —
 * the small-screen and dark-mode overrides.
 *
 * `ACCENT` is the GUI's primary blue darkened until white text on it clears
 * 4.5:1, since a button label is small text however bold it is.
 */
const INK = '#101828';
const INK_SOFT = '#5b6472';
const INK_FAINT = '#667085';
const PAGE_BG = '#f2f4f7';
const CARD_BG = '#ffffff';
const CARD_BORDER = '#e4e7ec';
const RULE = '#e6e9ee';
const PANEL_BG = '#f8f9fb';
const PANEL_BORDER = '#eceff3';
const ACCENT = '#0a76cc';

const FONT =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Pads the preview line so body text can't leak into it. */
const PREHEADER_FILL = '&#847;&zwnj;&nbsp;'.repeat(60);

/**
 * The document both share notifications render into: one 600px column that goes
 * full width on a phone, laid out with tables and `bgcolor` because Outlook
 * renders through Word and ignores anything more modern.
 *
 * `preheader` is the line the inbox shows beside the subject — it should add to
 * the subject, not repeat it. `content` is the card's rows; `footer` sits below
 * the card, where the reason-for-receiving and unsubscribe belong.
 */
const shareEmailLayout = (parts: {
    preheader: string;
    content: string;
    footer: string;
}): string => `
<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>{{subject_line}}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style>
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-spacing: 0; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    td { mso-line-height-rule: exactly; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    @media only screen and (max-width: 600px) {
        .col { width: 100% !important; }
        .pad { padding-left: 24px !important; padding-right: 24px !important; }
        .pad-y { padding-top: 28px !important; padding-bottom: 28px !important; }
        .h1 { font-size: 22px !important; line-height: 30px !important; }
        .btn { width: 100% !important; }
    }
    @media (prefers-color-scheme: dark) {
        .page { background-color: #0e1116 !important; }
        .card { background-color: #171b22 !important; border-color: #272d38 !important; }
        .ink { color: #e9ebef !important; }
        .ink-soft { color: #9aa3b2 !important; }
        .ink-soft a { color: #9aa3b2 !important; }
        .rule { border-color: #272d38 !important; }
        .panel { background-color: #1d222a !important; border-color: #2b323d !important; }
        .mark { color: #4da3f2 !important; }
    }
</style>
</head>
<body class="page" style="margin: 0; padding: 0; width: 100%; background-color: ${PAGE_BG};">
<div style="display: none; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all;">${parts.preheader}${PREHEADER_FILL}</div>
<div role="article" aria-roledescription="email" lang="en">
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background-color: ${PAGE_BG};">
<tr>
<td align="center" style="padding: 32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="col" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; text-align: left;">
    <tr>
        <td class="pad mark" style="padding: 0 4px 14px; font-family: ${FONT}; font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0.01em; color: ${ACCENT};">Puter</td>
    </tr>
    <tr>
        <td class="card" style="background-color: ${CARD_BG}; border: 1px solid ${CARD_BORDER}; border-radius: 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                <tr>
                    <td class="pad pad-y" style="padding: 36px 36px 34px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">${parts.content}
                        </table>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
    <tr>
        <td class="pad ink-soft" style="padding: 20px 4px 0; font-family: ${FONT}; font-size: 13px; line-height: 20px; color: ${INK_FAINT};">${parts.footer}
        </td>
    </tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</div>
</body>
</html>
`;

/** The greeting line above the heading. */
const greetingRow = (text: string): string => `
                            <tr>
                                <td class="ink-soft" style="padding: 0 0 6px; font-family: ${FONT}; font-size: 15px; line-height: 22px; color: ${INK_SOFT};">${text}</td>
                            </tr>`;

const headingRow = (text: string): string => `
                            <tr>
                                <td class="ink h1" style="padding: 0 0 18px; font-family: ${FONT}; font-size: 24px; line-height: 32px; font-weight: 700; letter-spacing: -0.01em; color: ${INK};">${text}</td>
                            </tr>`;

/**
 * One row per sender, hairline-separated. The wording comes pre-composed from
 * the digest (`digestLines`), so the list stays a list however many senders and
 * items fold into it.
 */
const SHARE_LIST_ROW = `
                            <tr>
                                <td class="panel" style="padding: 6px 18px; background-color: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER}; border-radius: 10px;">
                                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
                                        {{#each shares}}
                                        <tr>
                                            <td class="ink rule" style="padding: 12px 0;{{#unless @first}} border-top: 1px solid ${RULE};{{/unless}} font-family: ${FONT}; font-size: 16px; line-height: 24px; color: ${INK};"><strong style="font-weight: 600;">{{this.sender}}</strong> shared {{this.what}}</td>
                                        </tr>
                                        {{/each}}
                                    </table>
                                </td>
                            </tr>`;

/** A body paragraph. `padding` lets a caller tune the rhythm around it. */
const textRow = (text: string, padding = '18px 0 0'): string => `
                            <tr>
                                <td class="ink-soft" style="padding: ${padding}; font-family: ${FONT}; font-size: 15px; line-height: 23px; color: ${INK_SOFT};">${text}</td>
                            </tr>`;

/**
 * The call to action. Padding sits on the cell and the color on `bgcolor` so
 * Outlook still draws a real button (square-cornered, which is fine); the table
 * goes full width under 600px so the tap target spans the card.
 */
const buttonRow = (label: string): string => `
                            <tr>
                                <td style="padding: 26px 0 0;">
                                    <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
                                        <tr>
                                            <td align="center" bgcolor="${ACCENT}" style="background-color: ${ACCENT}; border-radius: 10px; padding: 14px 26px;">
                                                <a href="{{link}}" style="display: inline-block; font-family: ${FONT}; font-size: 16px; line-height: 20px; font-weight: 600; color: #ffffff; text-decoration: none;">${label}</a>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>`;

export const EMAIL_TEMPLATES = {
    'approved-for-listing': {
        subject: '🎉 Your app has been approved for listing!',
        html: `
<p>Hi there,</p>
<p>
Exciting news! <a href="https://puter.com/app/{{app_name}}">{{app_title}}</a> is now approved and live on <a href="https://puter.com/app/app-center" target="_blank">Puter App Center</a>. It's now ready for users worldwide to discover and enjoy.
</p>
<p>
<strong>Next Step</strong>: As your app begins to gain traction with more users, we will conduct periodic reviews to assess its performance and user engagement. Once your app meets our criteria, we'll invite you to our Incentive Program. This exclusive program will allow you to earn revenue each time users open your app. So, keep an eye out for updates and stay tuned for this exciting opportunity! Make sure to share your app with your fans, friends and family to help it gain traction: <a href="https://puter.com/app/{{app_name}}">https://puter.com/app/{{app_name}}</a>
</p>

<p>Best,<br />
The Puter Team
</p>
        `,
    },
    'listing-rejected': {
        subject: 'App Center Listing Request Rejected',
        html: `
<p>Hi{{#if owner_username}} {{owner_username}}{{/if}},</p>
<p>
Thanks for submitting <a href="https://puter.com/app/{{app_name}}">{{app_title}}</a> for the Puter App Center. We reviewed your listing and have rejected it for the following reason(s):
</p>
<blockquote>{{{nl2br reason}}}</blockquote>
<p>
Please update your app listing and resubmit when ready. If you have questions, just reply to this email.
</p>
<p>Best,<br />
The Puter Team
</p>
        `,
    },
    'listing-update-request': {
        subject: 'Update request for your app listing',
        html: `
<p>Hi{{#if owner_username}} {{owner_username}}{{/if}},</p>
<p>
Please update <a href="https://puter.com/app/{{app_name}}">{{app_title}}</a>.
</p>
<p><strong>Requested updates:</strong></p>
<blockquote>{{nl2br message}}</blockquote>
<p>Best,<br />
The Puter Team
</p>
        `,
    },
    'app-user-feedback': {
        subject: 'New user feedback for {{app_title}}',
        html: `
<p>Hi{{#if owner_username}} {{owner_username}}{{/if}},</p>
<p>
<strong>{{sender_username}}</strong>{{#if sender_email}} (<a href="mailto:{{sender_email}}">{{sender_email}}</a>){{/if}} sent feedback about <a href="{{app_link}}">{{app_title}}</a>:
</p>
<blockquote>{{{nl2br message}}}</blockquote>
{{#if sender_email}}<p>Just reply to this email to respond to them directly.</p>{{/if}}
<p>
You're receiving this because feedback is enabled for
<a href="{{app_link}}">{{app_title}}</a> — manage it in the
<a href="{{dev_center_link}}">Dev Center</a> under your app's settings.
</p>
<p>Best,<br />
The Puter Team
</p>
        `,
    },
    email_change_request: {
        subject: '📝 Confirm your email change',
        html: `
<p>Hi there,</p>
<p>
We received a request to link this email to the user "{{username}}" on Puter. If you made this request, please click the link below to confirm the change. If you did not make this request, please ignore this email.
</p>

<p>
<a href="{{confirm_url}}">Confirm email change</a>
</p>
        `,
    },
    email_change_notification: {
        subject: '📝 Notification of email change',
        html: `
<p>Hi there,</p>
<p>
We're sending an email to let you know about a change to your account.
We have sent a confirmation to "{{new_email}}" to confirm an email change request.
If this was not you, please contact support@puter.com immediately.
</p>
        `,
    },
    password_change_notification: {
        subject: '🔑 Password change notification',
        html: `
<p>Hi there,</p>
<p>
We're sending an email to let you know about a change to your account.
Your password was recently changed. If this was not you, please contact
support@puter.com immediately.
</p>
        `,
    },
    email_verification_code: {
        subject: '{{code}} is your confirmation code',
        html: `
<p>Hi there,</p>
<p><strong>{{code}}</strong> is your email confirmation code.</p>
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    email_verification_link: {
        subject: 'Please confirm your email',
        html: `
<p>Hi there,</p>
<p>Please confirm your email address using this link: <strong><a href="{{link}}">{{link}}</a></strong>.</p>
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    email_password_recovery: {
        subject: 'Password Recovery',
        html: `
<p>Hi there,</p>
<p>A password recovery request was issued for your account, please follow the link below to reset your password:</p>
<p><a href="{{link}}">{{link}}</a></p>
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    enabled_2fa: {
        subject: '2FA Enabled on your Account',
        html: `
<p>Hi there,</p>
<p>We're sending you this email to let you know 2FA was successfully enabled
on your account</p>
<p>If you did not perform this action please contact support@puter.com
immediately</p>
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    disabled_2fa: {
        subject: '2FA Disabled on your Account',
        html: `
<p>Hi there,</p>
<p>We hope you did this on purpose! 2FA Was disabled on your account.</p>
<p>If you did not perform this action please contact support@puter.com
immediately</p>
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    /**
     * A digest: shares to one recipient are held briefly and merged, so
     * `shares` may carry several senders. The subject is composed by the
     * service (see `digestSubject`), which owns the grouped wording.
     */
    file_shared_with_you: {
        subject: '{{subject_line}}',
        html: shareEmailLayout({
            preheader: 'Waiting for you under Shared with me.',
            content:
                greetingRow('Hi{{#if recipient}} {{recipient}}{{/if}},') +
                headingRow('Shared with you') +
                SHARE_LIST_ROW +
                buttonRow('Open Puter') +
                textRow(
                    'Shared items live under <span style="font-weight: 600;">Shared</span> in your files.',
                    '24px 0 0',
                ),
            footer: `You're receiving this because someone shared with your Puter account.{{#if unsubscribe_uuid}}
            <br /><a href="{{link}}/unsubscribe?user_uuid={{unsubscribe_uuid}}" style="color: inherit; text-decoration: underline;">Unsubscribe from notification emails</a>{{/if}}`,
        }),
        text: `
            Hi{{#if recipient}} {{recipient}}{{/if}},

            Shared with you on Puter:
            {{#each shares}}
            - {{this.sender}} shared {{this.what}}
            {{/each}}

            Open Puter: {{link}}

            Shared items live under "Shared" in your files.

            --
            You're receiving this because someone shared with your Puter account.
            {{#if unsubscribe_uuid}}Unsubscribe from notification emails:
            {{link}}/unsubscribe?user_uuid={{unsubscribe_uuid}}{{/if}}
        `,
    },
    // The only way to reach someone with no account. Same digest shape.
    file_shared_invite: {
        subject: '{{subject_line}}',
        html: shareEmailLayout({
            preheader: 'Claim it with a free Puter account.',
            content:
                greetingRow('Hi there,') +
                headingRow('Shared with you on Puter') +
                SHARE_LIST_ROW +
                textRow(
                    'There\'s no Puter account for <span style="font-weight: 600;">{{email}}</span> yet. Create one with this address, confirm it, and everything above will be waiting for you. It\'s free and takes about a minute.',
                ) +
                buttonRow('Create your free account') +
                textRow(
                    'Already on Puter? Add {{email}} to your account and confirm it to get the same access.',
                    '24px 0 0',
                ),
            footer: `You're receiving this because someone shared with {{email}}. Nothing is shared until the address is confirmed, so you can ignore this email and nothing happens.`,
        }),
        text: `
            Hi there,

            Shared with you on Puter:
            {{#each shares}}
            - {{this.sender}} shared {{this.what}}
            {{/each}}

            There's no Puter account for {{email}} yet. Create one with this
            address, confirm it, and everything above will be waiting for you.
            It's free and takes about a minute.

            Create your free account: {{link}}

            Already on Puter? Add {{email}} to your account and confirm it to get
            the same access.

            --
            You're receiving this because someone shared with {{email}}. Nothing is
            shared until the address is confirmed, so you can ignore this email
            and nothing happens.
        `,
    },
} satisfies Record<string, EmailTemplate>;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
