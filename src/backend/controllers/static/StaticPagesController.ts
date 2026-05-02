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

import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter';
import { promoteToVerifiedGroup } from '../../util/userProvisioning.js';

/**
 * One-off user-facing pages.
 *
 *   /robots.txt               — static text
 *   /sitemap.xml              — docs + approved apps
 *   /unsubscribe              — toggles `user.unsubscribed` from an email link
 *   /confirm-email-by-token   — email-link confirmation flow (distinct from
 *                               the POST /confirm-email JSON API used by the
 *                               in-app code-entry form)
 *
 * All root-subdomain-only, all unauthenticated (the confirm/unsubscribe
 * tokens in the query string are the auth).
 */
export class StaticPagesController extends PuterController {
    registerRoutes(router: PuterRouter) {
        const origin = this.config.origin ?? '';
        const docsOrigin = (() => {
            const d = this.config.domain;
            return d ? `https://docs.${d}` : '';
        })();

        const page = (
            icon: string,
            title: string,
            msg: string,
            color: string,
        ) => `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Puter</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                 Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f8f9fa;
    color: #1a1a1a;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.04);
    padding: 48px 40px;
    max-width: 420px;
    width: 100%;
    margin: 24px;
    text-align: center;
  }
  .icon {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: ${color}30;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 20px;
    font-size: 26px;
    line-height: 1;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #111;
  }
  p {
    font-size: 15px;
    line-height: 1.5;
    color: #555;
  }
  .links {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 16px;
    display: flex;
    justify-content: center;
    gap: 24px;
  }
  .links a {
    font-size: 13px;
    color: #888;
    text-decoration: none;
    transition: color .15s;
  }
  .links a:hover { color: #111; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${msg}</p>
  </div>
  <div class="links">
    <a href="${origin}">Home</a>
    <a href="${origin}/action/login">Log In</a>
    ${docsOrigin ? `<a href="${docsOrigin}">Docs</a>` : ''}
    <a href="${origin}/terms">Terms</a>
    <a href="${origin}/privacy">Privacy</a>
    <a href="https://github.com/HeyPuter/puter">GitHub</a>
  </div>
</body>
</html>`;
        const err = (msg: string) =>
            page('&#10005;', 'Something went wrong', msg, '#e53e3e');
        const ok = (msg: string) => page('&#10003;', 'Success', msg, '#38a169');

        // ── /robots.txt ─────────────────────────────────────────────
        router.get('/robots.txt', {}, (req, res) => {
            const domain = this.config.domain ?? req.hostname;
            const disallowed = [
                'AhrefsBot',
                'BLEXBot',
                'DotBot',
                'ia_archiver',
                'MJ12bot',
                'SearchmetricsBot',
                'SemrushBot',
            ];
            const body =
                disallowed
                    .map((ua) => `User-agent: ${ua}\nDisallow: /\n`)
                    .join('\n') +
                `\nSitemap: ${req.protocol}://${domain}/sitemap.xml\n`;
            res.type('text/plain').send(body);
        });

        // ── /sitemap.xml ────────────────────────────────────────────
        router.get('/sitemap.xml', {}, async (req, res) => {
            const domain = this.config.domain ?? req.hostname;
            const origin = `${req.protocol}://${domain}`;
            const apps = (await this.clients.db.read(
                'SELECT `name` FROM `apps` WHERE `approved_for_listing` = 1',
            )) as Array<{ name: string }>;
            const urls = [
                `<url><loc>${req.protocol}://docs.${domain}/</loc></url>`,
                ...apps.map(
                    (a) => `<url><loc>${origin}/app/${a.name}</loc></url>`,
                ),
            ];
            const body =
                '<?xml version="1.0" encoding="UTF-8"?>' +
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
                urls.join('') +
                '</urlset>';
            res.type('application/xml').send(body);
        });

        // ── /unsubscribe ────────────────────────────────────────────
        router.get('/unsubscribe', {}, async (req, res) => {
            const userUuid =
                typeof req.query.user_uuid === 'string'
                    ? req.query.user_uuid
                    : undefined;
            if (!userUuid) {
                res.send(err('user_uuid is required'));
                return;
            }

            const user = await this.stores.user.getByUuid(userUuid);
            if (!user) {
                res.send(err('User not found.'));
                return;
            }
            if (user.unsubscribed) {
                res.send(ok('You are already unsubscribed.'));
                return;
            }

            await this.stores.user.update(user.id, { unsubscribed: 1 });
            res.send(ok('You have successfully unsubscribed from all emails.'));
        });

        // ── /confirm-email-by-token ─────────────────────────────────
        router.get('/confirm-email-by-token', {}, async (req, res) => {
            const userUuid =
                typeof req.query.user_uuid === 'string'
                    ? req.query.user_uuid
                    : undefined;
            const token =
                typeof req.query.token === 'string'
                    ? req.query.token
                    : undefined;
            if (!userUuid) {
                res.send(err('user_uuid is required'));
                return;
            }
            if (!token) {
                res.send(err('token is required'));
                return;
            }

            const user = await this.stores.user.getByProperty(
                'uuid',
                userUuid,
                { force: true },
            );
            if (!user) {
                res.send(err('user not found.'));
                return;
            }
            if (user.email_confirmed) {
                res.send(ok('Email already confirmed.'));
                return;
            }
            if (user.email_confirm_token !== token) {
                res.send(err('invalid token.'));
                return;
            }

            // v2 writes `clean_email` at signup (lowercased email). Older rows
            // that predate that may be null — fall back to email.lower().
            const cleanEmail =
                (user.clean_email as string | null | undefined) ??
                String(user.email ?? '').toLowerCase();

            const [dupe] = (await this.clients.db.read(
                `SELECT EXISTS(
                    SELECT 1 FROM \`user\` WHERE (\`email\` = ? OR \`clean_email\` = ?)
                    AND \`email_confirmed\` = 1
                    AND \`password\` IS NOT NULL
                ) AS email_exists`,
                [user.email, cleanEmail],
            )) as Array<{ email_exists: number }>;
            if (dupe?.email_exists) {
                res.send(
                    err('This email was confirmed on a different account.'),
                );
                return;
            }

            // Revoke any other accounts' pending change-email slots targeting
            // this address — they're no longer valid once someone confirms it.
            await this.clients.db.write(
                'UPDATE `user` SET `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL WHERE `unconfirmed_change_email` = ?',
                [user.email],
            );

            await this.stores.user.update(user.id, {
                email_confirmed: 1,
                requires_email_confirmation: 0,
                email_confirm_code: null,
                email_confirm_token: null,
            });

            await promoteToVerifiedGroup(this.stores.group, this.config, user);

            // Best-effort side-channels — don't fail the user-visible response
            // if sockets or the event bus are unavailable.
            try {
                await this.services.socket.send(
                    { room: user.id },
                    'user.email_confirmed',
                    {},
                );
            } catch {
                /* ignore */
            }
            try {
                this.clients.event?.emit(
                    'user.email-confirmed',
                    {
                        user_id: user.id,
                        user_uid: user.uuid,
                        email: user.email,
                    },
                    {},
                );
            } catch {
                /* ignore */
            }

            res.send(ok('Your email has been successfully confirmed.'));
        });
    }
}
