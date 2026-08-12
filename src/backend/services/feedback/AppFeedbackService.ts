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

import { HttpError } from '../../core/http/HttpError.js';
import { PuterService } from '../types.js';

/**
 * User-to-developer app feedback ("send feedback to this app's developer").
 *
 * Feedback is gated per app by the `apps.feedback_enabled` column — off unless
 * enabled. The Dev Center enables it when it creates an app (its "User
 * Feedback" settings toggle turns it off); apps created through
 * `puter.apps.create`/`update` default to off and opt in via `feedbackEnabled`
 * in puter.js. Submissions are stored in `app_feedback` and a copy is emailed
 * to the app owner's confirmed email, subject to the caps below.
 *
 * Trust model: the submit endpoint only accepts user actors (never app tokens),
 * so an app cannot submit feedback programmatically — every message passes
 * through the GUI dialog (desktop) or the puter.com popup (external sites),
 * i.e. through a page the user actually typed into. App identity is likewise
 * never taken from the app: the desktop resolves it from its own process
 * registry, and the popup resolves it from the browser-attested opener origin
 * via AuthService.appUidFromOrigin.
 *
 * Abuse posture, layered:
 *
 * 1. Route rate limits (controller) — cheap first line, but the limiter fails open
 *    when its backend is down.
 * 2. Durable DB-count caps (here) — per (user, app) and per user per day. These
 *    read the `app_feedback` table itself, so they hold across restarts and
 *    nodes, and fail closed with the insert.
 * 3. Per-app daily email cap — bounds how much mail one app can generate to its
 *    owner regardless of how many distinct users submit. Feedback past the cap
 *    is still stored, just not emailed.
 */
export class AppFeedbackService extends PuterService {
    /** Max feedback message length, in characters (after normalization). */
    static readonly MESSAGE_MAX_LENGTH = 4000;
    /** Max feedback rows one user may create for one app per day. */
    static readonly PER_USER_APP_DAILY_LIMIT = 3;
    /** Max feedback rows one user may create across all apps per day. */
    static readonly PER_USER_DAILY_LIMIT = 10;
    /** Max owner emails one app may generate per day; rest is store-only. */
    static readonly PER_APP_DAILY_EMAIL_LIMIT = 20;

    /**
     * Normalize a raw feedback message: unify newlines, strip control
     * characters (except newline and tab), and trim. Returns the normalized
     * string, or null when nothing usable remains.
     */
    normalizeMessage(raw: unknown): string | null {
        if (typeof raw !== 'string') return null;
        const normalized = raw
            .replace(/\r\n?/g, '\n')
            // Strip C0 control chars (keeping \t and \n) and DEL.

            .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
            .trim();
        return normalized.length > 0 ? normalized : null;
    }

    /**
     * Resolve the target app for a feedback interaction. Exactly one of `app`
     * (uid or name) / `origin` (external site origin, resolved through the same
     * path token acquisition uses) must be provided.
     *
     * Returns the app row or null when no such app exists. Throws 400 on an
     * unparseable origin. A blocked origin resolves to null rather than
     * throwing — to a feedback caller "blocked" and "unknown" mean the same
     * thing: nobody is accepting feedback there.
     */
    async resolveTargetApp({
        app,
        origin,
    }: {
        app?: string;
        origin?: string;
    }): Promise<Record<string, unknown> | null> {
        if (app) {
            // Names may legally start with "app-" (e.g. "app-center"), so a
            // prefix heuristic would misroute them; try uid first, then name.
            return await this.stores.app.resolveApp(app);
        }
        if (origin) {
            let uid;
            try {
                uid = await this.services.auth.appUidFromOrigin(origin);
            } catch (e) {
                if (e instanceof HttpError && e.legacyCode === 'app_blocked') {
                    return null;
                }
                throw e;
            }
            return await this.stores.app.getByUid(uid);
        }
        return null;
    }

    /**
     * Whether `app` (a row from AppStore) currently accepts user feedback: the
     * developer opted in, the app has an owner to deliver to, and this
     * deployment can deliver at all (email transport configured). Without a
     * transport every submission would be stored-and-lost — the rows have no
     * other read path — while the sender is told it was sent, so the feature
     * reports itself unavailable instead.
     */
    acceptsFeedback(app: Record<string, unknown> | null): boolean {
        return Boolean(
            this.clients.email.isConfigured &&
            app &&
            app.feedback_enabled &&
            app.owner_user_id,
        );
    }

    /**
     * Pre-flight for the feedback dialog: does this target accept feedback, and
     * what should the dialog display? `app` fields are limited to what the
     * dialog needs — `name` is included because it's unique and
     * format-restricted, so the dialog can show it under the free-form title as
     * an anti-impersonation measure.
     */
    async getTarget(params: { app?: string; origin?: string }): Promise<{
        enabled: boolean;
        app: { name: string; title: string } | null;
    }> {
        const app = await this.resolveTargetApp(params);
        return {
            enabled: this.acceptsFeedback(app),
            app: app
                ? { name: String(app.name), title: String(app.title) }
                : null,
        };
    }

    /**
     * Store one feedback message and email it to the app's owner (best effort).
     * Caller (controller) has already authenticated the user and validated the
     * message's type and raw length; this method owns the business rules.
     *
     * @returns The stored row's public uid.
     */
    async submit({
        userId,
        app,
        origin,
        message,
        sourceEnv,
        sourceOrigin,
    }: {
        userId: number;
        app?: string;
        origin?: string;
        message: string;
        sourceEnv?: 'app' | 'web';
        sourceOrigin?: string | null;
    }): Promise<{ uid: string }> {
        const targetApp = await this.resolveTargetApp({ app, origin });
        if (!this.acceptsFeedback(targetApp)) {
            throw new HttpError(
                403,
                'This app is not accepting feedback right now',
                { legacyCode: 'feedback_not_enabled' },
            );
        }
        const appId = Number(targetApp!.id);
        const appUid = String(targetApp!.uid);

        const normalized = this.normalizeMessage(message);
        if (!normalized) {
            throw new HttpError(400, '`message` must not be empty', {
                legacyCode: 'bad_request',
            });
        }
        if (normalized.length > AppFeedbackService.MESSAGE_MAX_LENGTH) {
            throw new HttpError(
                400,
                `\`message\` is too long (max ${AppFeedbackService.MESSAGE_MAX_LENGTH} characters)`,
                { legacyCode: 'bad_request' },
            );
        }

        // Durable caps. Deliberately DB-backed (see class doc); the counts
        // ride the (user_id, created_at) / (app_id, created_at) indexes.
        // `includeOwnRow` distinguishes the pre-insert check (this
        // submission not yet counted) from the post-insert recount (it is).
        const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
        const capsBreached = async (
            includeOwnRow: boolean,
        ): Promise<boolean> => {
            const slack = includeOwnRow ? 1 : 0;
            const [userAppCount, userCount] = await Promise.all([
                this.stores.appFeedback.countByUserAndAppSince(
                    userId,
                    appId,
                    since,
                ),
                this.stores.appFeedback.countByUserSince(userId, since),
            ]);
            return (
                userAppCount >=
                    AppFeedbackService.PER_USER_APP_DAILY_LIMIT + slack ||
                userCount >= AppFeedbackService.PER_USER_DAILY_LIMIT + slack
            );
        };
        const tooManyError = new HttpError(
            429,
            'You have sent a lot of feedback recently — please try again later',
            { legacyCode: 'too_many_requests' },
        );
        if (await capsBreached(false)) {
            throw tooManyError;
        }

        const row = await this.stores.appFeedback.create({
            appId,
            appUid,
            userId,
            message: normalized,
            sourceEnv: sourceEnv ?? null,
            sourceOrigin: sourceOrigin ?? null,
        });

        // The pre-check is check-then-insert, so parallel submissions (or
        // multiple nodes) can all pass it on the same stale count. Recount
        // with this row included and roll it back if a concurrent burst
        // pushed past a cap — these caps must fail closed, not just usually
        // hold.
        if (await capsBreached(true)) {
            await this.stores.appFeedback.deleteById(row.id);
            throw tooManyError;
        }

        // Email delivery is best-effort: any failure past this point must
        // not fail the request — the feedback is already stored.
        try {
            await this.#emailOwner({
                app: targetApp!,
                appId,
                feedbackId: row.id,
                message: normalized,
                senderUserId: userId,
                since,
            });
        } catch (e) {
            console.warn('[app-feedback] owner email failed:', e);
        }

        return { uid: row.uid };
    }

    /**
     * Deliver one feedback email to the app owner if every delivery
     * precondition holds; otherwise silently skip (the row stays stored with
     * `email_sent = 0`). Preconditions: transport configured, owner exists with
     * a confirmed non-blocklisted email, owner not suspended and not
     * unsubscribed, per-app daily email cap not reached.
     */
    async #emailOwner({
        app,
        appId,
        feedbackId,
        message,
        senderUserId,
        since,
    }: {
        app: Record<string, unknown>;
        appId: number;
        feedbackId: number;
        message: string;
        senderUserId: number;
        since: number;
    }): Promise<void> {
        if (!this.clients.email.isConfigured) return;

        const owner = await this.stores.user.getById(Number(app.owner_user_id));
        if (
            !owner ||
            !owner.email ||
            !owner.email_confirmed ||
            owner.suspended ||
            Boolean(owner.unsubscribed)
        ) {
            return;
        }
        if (!(await this.clients.email.validate(owner.email))) return;

        // Claim an email-cap slot *before* sending: flip email_sent, recount
        // with the claim included, and release the slot if a concurrent
        // burst pushed past the cap. Counting before sending would fail
        // open — parallel submissions could each read an under-cap count and
        // all send. The cost is that a crash mid-send burns a slot without
        // delivering; the cap is an upper bound, not a quota owed.
        await this.stores.appFeedback.markEmailSent(feedbackId);
        const emailedToday =
            await this.stores.appFeedback.countEmailedByAppSince(appId, since);
        if (emailedToday > AppFeedbackService.PER_APP_DAILY_EMAIL_LIMIT) {
            await this.stores.appFeedback.unmarkEmailSent(feedbackId);
            return;
        }

        const sender = await this.stores.user.getById(senderUserId);
        // Share the sender's email so the developer can respond — but only
        // when it's verified. An unverified address can be anyone's (typed at
        // signup, never proven), so using it as Reply-To would let a sender
        // point the developer's reply at a stranger's inbox. Unverified
        // senders still get their feedback delivered, just without a
        // reply path. The dialog's privacy note mirrors this split (see
        // app_feedback_privacy_note / app_feedback_privacy_note_no_email).
        const senderEmail =
            sender?.email && sender.email_confirmed ? sender.email : null;

        try {
            await this.clients.email.send(
                owner.email,
                'app-user-feedback',
                {
                    owner_username: owner.username,
                    sender_username: sender?.username ?? 'A Puter user',
                    sender_email: senderEmail,
                    // Collapse whitespace so a crafted title can't break the
                    // subject header or spoof extra lines in the body.
                    app_title: String(app.title ?? app.name).replace(
                        /\s+/g,
                        ' ',
                    ),
                    app_name: String(app.name),
                    app_link: `${this.config.origin}/app/${encodeURIComponent(String(app.name))}`,
                    // The footer's "manage it" pointer — built from
                    // config.origin like app_link so it holds on self-hosted
                    // deployments.
                    dev_center_link: `${this.config.origin}/app/dev-center`,
                    message,
                },
                senderEmail ? { replyTo: senderEmail } : {},
            );
        } catch (e) {
            // Release the claimed slot — the mail never went out.
            await this.stores.appFeedback.unmarkEmailSent(feedbackId);
            throw e;
        }
    }
}
