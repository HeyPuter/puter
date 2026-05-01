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

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { PuterService } from '../types.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import { generateDefaultFsentries } from '../../util/userProvisioning.js';
import type { AppIconService } from '../appIcon/AppIconService.js';

const USERNAME = 'admin';
const ADMIN_GROUP_UID = 'ca342a5e-b13d-4dee-9048-58b11a57cc55';
const ADMIN_STORAGE_BYTES = 10 * 1024 * 1024 * 1024;

/**
 * Bootstraps the `admin` user on first boot for self-hosted deployments.
 *
 * If no admin exists, creates one with a random 8-char hex password, places
 * them in the admin group, and stashes the plaintext under
 * `metadata.tmp_password` so we can detect on later boots whether the
 * operator has rotated it yet.
 *
 * Each boot where the current password hash still matches the stashed
 * plaintext, the credentials are re-printed to stdout (CI scrapes this
 * line to extract the default password).
 */
export class DefaultUserService extends PuterService {
    override async onServerStart(): Promise<void> {
        let user = await this.stores.user.getByUsername(USERNAME);
        let tmpPassword: string;

        if (!user) {
            tmpPassword = crypto.randomBytes(4).toString('hex');
            user = await this.#createAdminUser(tmpPassword);
            // AppIconService is registered before us, so its own onServerStart
            // bailed on its first-boot bootstrap (admin didn't exist yet).
            // Poke it here so the `/system/app_icons/` dir + subdomain exist
            // by the time the first icon arrives.
            await (
                this.services.appIcon as AppIconService
            ).ensureIconsDirectory();
        } else {
            const metadata = (user.metadata ?? {}) as Record<string, unknown>;
            const stashed = metadata.tmp_password;
            if (typeof stashed !== 'string' || stashed === '') return;
            tmpPassword = stashed;
        }

        if (!user.password) return;
        const isDefault = await bcrypt.compare(
            tmpPassword,
            String(user.password),
        );
        if (!isDefault) return;

        this.#printCredentials(tmpPassword);
    }

    async #createAdminUser(tmpPassword: string): Promise<UserRow> {
        const passwordHash = await bcrypt.hash(tmpPassword, 8);

        const created = await this.stores.user.create({
            username: USERNAME,
            uuid: uuidv4(),
            password: passwordHash,
            email: null,
            free_storage: ADMIN_STORAGE_BYTES,
            requires_email_confirmation: false,
        });

        await this.stores.user.updateMetadata(created.id, {
            tmp_password: tmpPassword,
        });

        try {
            await this.stores.group.addUsers(ADMIN_GROUP_UID, [USERNAME]);
        } catch (e) {
            console.warn(
                '[default-user] failed to add admin to admin group',
                e,
            );
        }

        try {
            await generateDefaultFsentries(
                this.clients.db,
                this.stores.user,
                created,
            );
        } catch (e) {
            console.warn(
                '[default-user] failed to provision admin home directory',
                e,
            );
        }

        return (await this.stores.user.getById(created.id)) ?? created;
    }

    #printCredentials(tmpPassword: string): void {
        console.log(`password for admin is: ${tmpPassword}`);
        console.log(
            '\n************************************************************',
        );
        console.log('* Your default login credentials are:');
        console.log('* Username: admin');
        console.log(`* Password: ${tmpPassword}`);
        console.log('* (change the password to remove this message)');
        console.log(
            '************************************************************\n',
        );
    }
}
