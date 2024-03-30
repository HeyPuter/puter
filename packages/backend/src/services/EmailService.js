/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("puter-js-common");

class Emailservice extends AdvancedBase {
    static MODULES = {
        nodemailer: require('nodemailer'),
        handlebars: require('handlebars'),
    };

    constructor ({ services, config }) {
        super();
        this.config = config;

        this.templates = {
            'new-referral': {
                subject: `You've made a referral!`,
                html: `<p>Hi there,</p>
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
        };

        this.template_fns = {};
        for ( const k in this.templates ) {
            const template = this.templates[k];
            this.template_fns[k] = values => {
                const html = this.modules.handlebars.compile(template.html);
                return {
                    ...template,
                    html: html(values),
                };
            }
        }
    }

    async send_email (user, template, values) {
        const config = this.config;
        const nodemailer = this.modules.nodemailer;

        let transporter = nodemailer.createTransport({
            host: config.smtp_server,
            port: config.smpt_port,
            secure: true, // STARTTLS
            auth: {
                user: config.smtp_username,
                pass: config.smtp_password,
            },
        });

        const email = user.email;

        const template_fn = this.template_fns[template];
        const { subject, html } = template_fn(values);

        transporter.sendMail({
            from: '"Puter" no-reply@puter.com', // sender address
            to: email, // list of receivers
            subject, html,
        });
    }
}

module.exports = {
    Emailservice
};
