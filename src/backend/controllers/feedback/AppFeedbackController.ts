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

import type { Request, Response } from 'express';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { AppFeedbackService } from '../../services/feedback/AppFeedbackService.js';
import { PuterController } from '../types.js';

/**
 * Endpoints behind the "send feedback to this app's developer" dialog
 * (`puter.ui.showFeedbackDialog()`). Only the GUI (desktop dialog or the
 * puter.com popup) calls these; apps cannot — both routes reject app actors,
 * which is what makes feedback impossible to submit programmatically on a
 * user's behalf.
 *
 * The target may be named either by `app` (uid or name — the desktop knows
 * which app asked) or by `origin` (external site — the popup passes its
 * browser-attested opener origin). Exactly one must be provided.
 */

/** Sanity cap on the raw body field; the service enforces the real limit. */
const RAW_MESSAGE_CAP = 50_000;

// Upper bound on the `app`/`origin` target params. Must not exceed the
// `source_origin` column (VARCHAR(2048) on MySQL/Postgres): the raw origin is
// stored verbatim, and a longer value would fail the INSERT after passing
// every validation — or be silently truncated on non-strict MySQL.
const TARGET_PARAM_MAX_LENGTH = 2048;

const readTargetParam = (value: unknown): string | undefined => {
    return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= TARGET_PARAM_MAX_LENGTH
        ? value
        : undefined;
};

@Controller('/app-feedback')
export class AppFeedbackController extends PuterController {
    /**
     * GET /app-feedback/target — pre-flight for the dialog: whether the target
     * app accepts feedback, plus its canonical title/name for display. Reveals
     * nothing that `puter.apps.get` doesn't already.
     */
    @Get('/target', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        rateLimit: {
            scope: 'app-feedback-target',
            limit: 60,
            window: 60_000,
            key: 'user',
        },
    })
    async target(req: Request, res: Response): Promise<void> {
        const app = readTargetParam(req.query.app);
        const origin = readTargetParam(req.query.origin);
        if (!app === !origin) {
            throw new HttpError(
                400,
                'Exactly one of `app` and `origin` is required',
                { legacyCode: 'bad_request' },
            );
        }

        const service = this.services.appFeedback as AppFeedbackService;
        res.json(await service.getTarget({ app, origin }));
    }

    /**
     * POST /app-feedback — store one feedback message and email the app's
     * developer. Strict limits: the route limits below are the cheap first
     * line; AppFeedbackService enforces durable per-user/per-app daily caps
     * from the database (the route limiter fails open, the DB caps don't).
     */
    @Post('/', {
        subdomain: 'api',
        requireUserActor: true,
        requireVerified: true,
        // Submissions only ever originate from our own GUI pages (desktop
        // dialog / popup). Cross-origin browser pages get stopped here even
        // if they somehow hold a user token; non-browser clients still pass
        // and are handled by the caps.
        guiOriginOnly: true,
        rateLimit: [
            {
                scope: 'app-feedback-user',
                limit: 5,
                window: 30 * 60_000,
                key: 'user',
            },
            // IP backstop so freshly minted accounts can't stack per-user
            // budgets from one machine.
            {
                scope: 'app-feedback-ip',
                limit: 30,
                window: 24 * 60 * 60_000,
                key: 'ip',
            },
        ],
    })
    async submit(req: Request, res: Response): Promise<void> {
        const body = req.body ?? {};
        const app = readTargetParam(body.app);
        const origin = readTargetParam(body.origin);
        if (!app === !origin) {
            throw new HttpError(
                400,
                'Exactly one of `app` and `origin` is required',
                { legacyCode: 'bad_request' },
            );
        }

        const message = body.message;
        if (typeof message !== 'string' || message.length === 0) {
            throw new HttpError(400, '`message` is required', {
                legacyCode: 'bad_request',
            });
        }
        if (message.length > RAW_MESSAGE_CAP) {
            throw new HttpError(
                400,
                `\`message\` is too long (max ${AppFeedbackService.MESSAGE_MAX_LENGTH} characters)`,
                { legacyCode: 'bad_request' },
            );
        }

        const sourceEnv =
            body.context === 'app' || body.context === 'web'
                ? body.context
                : undefined;

        const userId = req.actor?.user?.id;
        if (!userId) {
            throw new HttpError(401, 'Unauthorized', {
                legacyCode: 'unauthorized',
            });
        }

        const service = this.services.appFeedback as AppFeedbackService;
        await service.submit({
            userId,
            app,
            origin,
            message,
            sourceEnv,
            sourceOrigin: origin ?? null,
        });
        res.json({});
    }
}
