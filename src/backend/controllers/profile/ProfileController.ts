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
import type { ProfileService } from '../../services/profile/ProfileService.js';
import { PuterController } from '../types.js';

// Shape only; the store decides whether the account exists.
const USERNAME_PATTERN = /^[a-z0-9_-]{1,64}$/i;

const notFound = () =>
    new HttpError(404, 'Profile not found', { legacyCode: 'not_found' });

/**
 * User profiles. Reads are open so an app can show another user's profile, but
 * a profile other than the caller's own is served only while its owner is on a
 * paid plan (`ProfileService.isPubliclyVisible`); a hidden one 404s like a
 * missing account, so the response says nothing about the plan.
 */
@Controller('/profile')
export class ProfileController extends PuterController {
    /**
     * GET /profile?username=<name> — a user's profile. Without `username`, the
     * signed-in user's own.
     */
    @Get('/', {
        subdomain: 'api',
        rateLimit: {
            scope: 'profile-read',
            limit: 120,
            window: 60_000,
            key: 'ip',
        },
    })
    async get(req: Request, res: Response): Promise<void> {
        const service = this.services.profile as ProfileService;
        const caller = req.actor?.user;
        const username = req.query.username;

        let target;
        if (username === undefined) {
            if (!caller?.uuid) {
                throw new HttpError(401, 'Sign in, or pass a username', {
                    legacyCode: 'unauthorized',
                });
            }
            target = await this.stores.user.getByUuid(caller.uuid);
        } else {
            if (
                typeof username !== 'string' ||
                !USERNAME_PATTERN.test(username)
            ) {
                throw new HttpError(400, 'Invalid username', {
                    legacyCode: 'bad_request',
                });
            }
            target = await this.stores.user.getByUsername(username);
        }
        if (!target) throw notFound();

        const isOwner = caller?.uuid === target.uuid;
        if (!isOwner && !(await service.isPubliclyVisible(target))) {
            throw notFound();
        }
        res.json(await service.getProfile(target));
    }

    /** POST /profile — update the signed-in user's own profile. */
    @Post('/', {
        subdomain: 'api',
        requireUserActor: true,
        rateLimit: {
            scope: 'profile-write',
            limit: 30,
            window: 60_000,
            key: 'user',
        },
    })
    async update(req: Request, res: Response): Promise<void> {
        const service = this.services.profile as ProfileService;
        const user = await this.stores.user.getByUuid(req.actor!.user.uuid!);
        if (!user) throw notFound();
        res.json(await service.updateProfile(user, req.body));
    }
}
