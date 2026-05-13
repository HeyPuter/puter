/**
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
 * Email template definitions. Keys are the template names; values are
 * the Handlebars-compilable `subject` and `html` strings.
 *
 * Rendered values are supplied by callers of `EmailClient.send()`.
 * Variables use standard Handlebars syntax: `{{var}}`, `{{#if cond}}…{{/if}}`,
 * and the custom helper `{{{nl2br text}}}` for HTML-safe newline conversion.
 */

export interface EmailTemplate {
    subject: string;
    html: string;
}

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
