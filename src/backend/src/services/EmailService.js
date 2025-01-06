// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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

const BaseService = require('./BaseService');

const TEMPLATES = {
    'new-referral': {
        subject: `You've made a referral!`,
        html: `
            <p>Hi there,</p>
            <p>A new user has used your referral code. Enjoy an extra {{storage_increase}} of storage, on the house!</p>
            <p>Sincerely,</p>
            <p>Puter</p>
        `,
    },
    'approved-for-listing': {
        subject: '\u{1f389} Your app has been approved for listing!',
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
    'email_change_request': {
        subject: '\u{1f4dd} Confirm your email change',
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
    'email_change_notification': {
        subject: '\u{1f4dd} Notification of email change',
        html: `
<p>Hi there,</p>
<p>
We're sending an email to let you know about a change to your account.
We have sent a confirmation to "{{new_email}}" to confirm an email change request.
If this was not you, please contact support@puter.com immediately.
</p>
        `,
    },
    'password_change_notification': {
        subject: '\u{1f511} Password change notification',
        html: /*html*/`
        <p>Hi there,</p>
        <p>
        We're sending an email to let you know about a change to your account.
        Your password was recently changed. If this was not you, please contact
        support@puter.com immediately.
        </p>
        `,
    },
    'email_verification_code': {
        subject: `{{code}} is your confirmation code`,
        html: /*html*/`
        <p>Hi there,</p>
        <p><strong>{{code}}</strong> is your email confirmation code.</p>
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
    'email_verification_link': {
        subject: `Please confirm your email`,
        html: /*html*/`
        <p>Hi there,</p>
        <p>Please confirm your email address using this link: <strong><a href="{{link}}">{{link}}</a></strong>.</p>
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
    'email_password_recovery': {
        subject: `Password Recovery`,
        html: /*html*/`
        <p>Hi there,</p>
        <p>A password recovery request was issued for your account, please follow the link below to reset your password:</p>
        <p><a href="{{link}}">{{link}}</a></p>
        <p>Sincerely,</p>
        <p>Puter</p>
        `,
    },
    'enabled_2fa': {
        subject: '2FA Enabled on your Account',
        html: `
        <p>Hi there,</p>
        <p>We're sending you this email to let you know 2FA was successfully enabled
        on your account</p>
        <p>If you did not perform this action please contact support@puter.com
        immediately</p>
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
    'disabled_2fa': {
        subject: '2FA Disabled on your Account',
        html: `
        <p>Hi there,</p>
        <p>We hope you did this on purpose! 2FA Was disabled on your account.</p>
        <p>If you did not perform this action please contact support@puter.com
        immediately</p>
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
    // TODO: revise email contents
    'share_by_username': {
        subject: 'Puter share from {{susername}}',
        html: /*html*/`
        <p>Hi there {{rusername}},</p>
        <p>You've received a share from {{susername}} on Puter.</p>
        <p>Go to puter.com to check it out.</p>
        {{#if message}}
            <p>The following message was included:</p>
            <blockquote>{{message}}</blockquote>
        {{/if}}
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
    'share_by_email': {
        subject: 'share by email',
        html: /*html*/`
        <p>Hi there,</p>
        <p>You've received a share from {{sender_name}} on Puter:</p>
        <p><a href="{{link}}">{{link}}</a></p>
        {{#if message}}
            <p>The following message was included:</p>
            <blockquote>{{message}}</blockquote>
        {{/if}}
        <p>Sincerely,</p>
        <p>Puter</p>
        `
    },
}


/**
* @class EmailService
* @extends BaseService
* @description The EmailService class handles the sending of emails using predefined templates.
* It utilizes the nodemailer library for sending emails and Handlebars for template rendering.
* The class includes methods for constructing and initializing the service, getting the email transport,
* and sending emails with provided templates and values.
*/
class Emailservice extends BaseService {
    static MODULES = {
        nodemailer: require('nodemailer'),
        handlebars: require('handlebars'),
        dedent: require('dedent'),
    };


    /**
    * Initializes the EmailService by compiling email templates.
    *
    * This method compiles the email templates using Handlebars and dedent
    * to ensure that they are ready for use. It stores the compiled templates
    * in an object for quick access.
    *
    * @returns {void}
    */
    _construct () {
        this.templates = TEMPLATES;

        this.template_fns = {};
        for ( const k in this.templates ) {
            const template = this.templates[k];
            this.template_fns[k] = values => {
                const subject = this.modules.handlebars.compile(template.subject);
                const html =
                    this.modules.handlebars.compile(
                        this.modules.dedent(template.html));
                return {
                    ...template,
                    subject: subject(values),
                    html: html(values),
                };
            }
        }
    }


    /**
    * Initializes the email service.
    * This method is called during the initialization phase of the service.
    * It sets up any necessary configurations or resources needed for the service to function correctly.
    *
    * @returns {void}
    */
    _init () {
    }


    /**
    * Configures and initializes the email transport using Nodemailer.
    *
    * This method sets up the email transport configuration based on the provided settings and
    * returns a configured Nodemailer transport object.
    *
    * @returns {Object} The configured Nodemailer transport object.
    */
    get_transport_ () {
        const nodemailer = this.modules.nodemailer;

        const config = { ...this.config };
        delete config.engine;

        let transport = nodemailer.createTransport(config);

        return transport;
    }


    /**
    * Sends an email using the configured transport and template.
    *
    * This method constructs an email message by applying the provided values to the specified template,
    * then sends the email using the configured transport.
    *
    * @param {Object} user - The user object containing the email address.
    * @param {string} template - The template key to use for constructing the email.
    * @param {Object} values - The values to apply to the template.
    * @returns {Promise<void>} - A promise that resolves when the email is sent.
    */
    async send_email (user, template, values) {
        const email = user.email;

        const template_fn = this.template_fns[template];
        const { subject, html } = template_fn(values);

        const transporter = this.get_transport_();
        transporter.sendMail({
            from: '"Puter" no-reply@puter.com', // sender address
            to: email, // list of receivers
            subject, html,
        });
    }

    // simple passthrough to nodemailer
    sendMail (params) {
        const transporter = this.get_transport_();
        transporter.sendMail(params);
    }
}

module.exports = {
    Emailservice
};
