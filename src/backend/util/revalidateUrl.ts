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

import type { EventClient } from '../clients/event/EventClient.js';
import type { OIDCService } from '../services/auth/OIDCService.js';
import type { UserRow } from '../stores/user/UserStore.js';
import type { IConfig } from '../types.js';

export interface RevalidateUrlDeps {
    config: IConfig;
    event: Pick<EventClient, 'emitAndWait'> | null | undefined;
    oidc: Pick<OIDCService, 'getLinkedProviderForUser'>;
}

/**
 * Where a password-less account goes to sign in again before a protected
 * action, or null when it has nowhere to go. An `auth.reauth.options` listener
 * supplies the URL; without one, it's built from the account's core OIDC link.
 */
export async function resolveRevalidateUrl(
    user: Pick<UserRow, 'id' | 'uuid'>,
    deps: RevalidateUrlDeps,
): Promise<string | null> {
    const event = {
        userId: user.id,
        userUuid: user.uuid,
        revalidateUrl: null as string | null,
    };
    await deps.event?.emitAndWait('auth.reauth.options', event, {});
    if (typeof event.revalidateUrl === 'string' && event.revalidateUrl) {
        return event.revalidateUrl;
    }

    let provider: string | null;
    try {
        provider = await deps.oidc.getLinkedProviderForUser(user.id);
    } catch {
        // OIDC not configured
        return null;
    }
    if (!provider) return null;
    const origin = (deps.config.origin ?? '').replace(/\/$/, '');
    return `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_uuid=${encodeURIComponent(user.uuid)}`;
}
