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
     * Plain-text alternative part. When present the message goes out as
     * multipart/alternative — better deliverability, and a readable fallback
     * for clients (and filters) that don't render HTML. Compiled with
     * `noEscape`: it is not HTML, so entities would be read literally.
     */
    text?: string;
}

// -- Share email layout -------------------------------------------------
//
// The sharing notifications are the emails most often sent to addresses that
// never asked to hear from Puter, so they carry the full email-client
// boilerplate: a complete document, table layout, inline styles, hidden
// preview text, and dark-mode overrides. Interpolations sit at column 0 so
// `dedent` (applied at compile time) leaves the markup untouched.

const FONT =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Bulletproof-enough CTA: padding lives on the link so the whole button is
 * clickable, `mso-padding-alt` gives Outlook the same visual size (there only
 * the label is clickable, which is the accepted degradation).
 */
const shareCta = (label: string, href: string): string => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0 0;">
<tr>
<td style="border-radius: 8px; background-color: #0473c9; mso-padding-alt: 13px 36px;">
<a href="${href}" target="_blank" style="display: inline-block; padding: 13px 36px; font-family: ${FONT}; font-size: 15px; font-weight: 600; line-height: 20px; color: #ffffff; text-decoration: none; border-radius: 8px;">${label}</a>
</td>
</tr>
</table>`;

/** One row per sender: "**alice** shared report.txt". */
const shareList = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="list-panel" style="margin: 20px 0 0; background-color: #f6f8fb; border-radius: 10px; border-collapse: separate;">
{{#each shares}}
<tr>
<td class="share-row" style="padding: 12px 16px;{{#unless @first}} border-top: 1px solid #e9edf3;{{/unless}} font-family: ${FONT}; font-size: 15px; line-height: 22px; color: #1f2937;">
<strong style="font-weight: 600;">{{this.sender}}</strong> shared {{this.what}}
</td>
</tr>
{{/each}}
</table>`;

const shareEmailShell = (opts: {
    /** Preview line clients show next to the subject; hidden in the body. */
    preheader: string;
    /** `<title>` — read by screen readers and a few clients. */
    title: string;
    /** The card's inner HTML: tables and inline styles only. */
    content: string;
    /** Small print under the card: why they got this, how to opt out. */
    footer: string;
}): string => `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${opts.title}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>td, p, a, span { font-family: Arial, Helvetica, sans-serif !important; }</style>
<![endif]-->
<style>
  html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .card { padding: 24px 20px !important; }
    .px { padding-left: 12px !important; padding-right: 12px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .email-bg { background-color: #16181d !important; }
    .card { background-color: #1f2229 !important; border-color: #2e323b !important; }
    .text-main { color: #e7eaee !important; }
    .text-muted { color: #9aa3b0 !important; }
    .list-panel { background-color: #262a32 !important; }
    .share-row { border-color: #333845 !important; color: #e7eaee !important; }
    .wordmark { color: #e7eaee !important; }
    .footer-link { color: #9aa3b0 !important; }
  }
</style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: #f0f3f7; word-break: break-word;">
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${opts.preheader}${'&nbsp;&zwnj;'.repeat(30)}</div>
<div role="article" aria-roledescription="email" lang="en">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background-color: #f0f3f7;">
<tr>
<td align="center" class="px" style="padding: 32px 24px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="container" style="width: 560px; max-width: 560px;">
<tr>
<td align="center" style="padding: 0 0 20px;">
<a href="{{link}}" target="_blank" class="wordmark" style="font-family: ${FONT}; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: #1f2937; text-decoration: none;">Puter</a>
</td>
</tr>
<tr>
<td class="card" style="background-color: #ffffff; border: 1px solid #e3e8ee; border-radius: 12px; padding: 32px;">
${opts.content}
</td>
</tr>
<tr>
<td style="padding: 20px 12px 0;">
${opts.footer}
</td>
</tr>
</table>
</td>
</tr>
</table>
</div>
</body>
</html>`;

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
        html: shareEmailShell({
            title: '{{subject_line}}',
            preheader: 'It&rsquo;s waiting for you in your Puter account.',
            content: `
<p class="text-main" style="margin: 0; font-family: ${FONT}; font-size: 16px; line-height: 24px; font-weight: 600; color: #111827;">Hi {{recipient}},</p>
<p class="text-main" style="margin: 12px 0 0; font-family: ${FONT}; font-size: 15px; line-height: 22px; color: #374151;">Here&rsquo;s what was shared with you on Puter:</p>
${shareList}
${shareCta('Open Puter', '{{link}}')}
<p class="text-muted" style="margin: 20px 0 0; font-family: ${FONT}; font-size: 13px; line-height: 20px; color: #6b7280;">You&rsquo;ll find everything under &ldquo;Shared with me&rdquo; in your files.</p>`,
            footer: `
<p class="text-muted" style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #8a94a3; text-align: center;">
You&rsquo;re receiving this because someone shared items with your Puter account.
{{#if unsubscribe_uuid}}
<br><a href="{{link}}/unsubscribe?user_uuid={{unsubscribe_uuid}}" target="_blank" class="footer-link" style="color: #8a94a3; text-decoration: underline;">Unsubscribe</a> from Puter email notifications.
{{/if}}
</p>`,
        }),
        text: `
Hi {{recipient}},

Here's what was shared with you on Puter:

{{#each shares}}
* {{this.sender}} shared {{this.what}}
{{/each}}

Open Puter: {{link}}

You're receiving this because someone shared items with your Puter account.
{{#if unsubscribe_uuid}}Unsubscribe: {{link}}/unsubscribe?user_uuid={{unsubscribe_uuid}}{{/if}}
        `,
    },
    // The only way to reach someone with no account. Same digest shape.
    // Careful: "Open Puter" must not appear here — it is how the holder
    // digest is told apart from this one.
    file_shared_invite: {
        subject: '{{subject_line}}',
        html: shareEmailShell({
            title: '{{subject_line}}',
            preheader:
                'Create a free Puter account with this email address to view it.',
            content: `
<p class="text-main" style="margin: 0; font-family: ${FONT}; font-size: 16px; line-height: 24px; font-weight: 600; color: #111827;">Hi there,</p>
<p class="text-main" style="margin: 12px 0 0; font-family: ${FONT}; font-size: 15px; line-height: 22px; color: #374151;">Here&rsquo;s what was shared with you on Puter:</p>
${shareList}
<p class="text-main" style="margin: 20px 0 0; font-family: ${FONT}; font-size: 15px; line-height: 22px; color: #374151;">There&rsquo;s no Puter account for <strong>{{email}}</strong> yet. Create a free account with this exact address, confirm it, and everything shared with you will be waiting in your files.</p>
${shareCta('Create your account', '{{link}}')}
<p class="text-muted" style="margin: 20px 0 0; font-family: ${FONT}; font-size: 13px; line-height: 20px; color: #6b7280;">New to Puter? It&rsquo;s the open-source Internet OS &mdash; your files, apps, and games in one place, from any device.</p>`,
            footer: `
<p class="text-muted" style="margin: 0; font-family: ${FONT}; font-size: 12px; line-height: 18px; color: #8a94a3; text-align: center;">
You&rsquo;re receiving this because a Puter user shared something with this email address.
<br>If you weren&rsquo;t expecting it, you can safely ignore this email.
</p>`,
        }),
        text: `
Hi there,

Here's what was shared with you on Puter:

{{#each shares}}
* {{this.sender}} shared {{this.what}}
{{/each}}

There's no Puter account for {{email}} yet. Create a free account with this
exact address, confirm it, and everything shared with you will be waiting.

Create your account: {{link}}

You're receiving this because a Puter user shared something with this email
address. If you weren't expecting it, you can safely ignore this email.
        `,
    },
    share_by_username: {
        subject: 'Puter share from {{susername}}',
        html: `
<p>Hi there {{rusername}},</p>
<p>You've received a share from {{susername}} on Puter.</p>
<p>Go to puter.com to check it out.</p>
{{#if message}}
    <p>The following message was included:</p>
    <blockquote>{{message}}</blockquote>
{{/if}}
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
    share_by_email: {
        subject: 'share by email',
        html: `
<p>Hi there,</p>
<p>You've received a share from {{sender_name}} on Puter:</p>
<p><a href="{{link}}">{{link}}</a></p>
{{#if message}}
    <p>The following message was included:</p>
    <blockquote>{{message}}</blockquote>
{{/if}}
<p>Sincerely,</p>
<p>Puter</p>
        `,
    },
} satisfies Record<string, EmailTemplate>;

export type EmailTemplateName = keyof typeof EMAIL_TEMPLATES;
