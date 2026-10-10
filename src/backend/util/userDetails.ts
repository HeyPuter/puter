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

import type { OIDCService } from '../services/auth/OIDCService.js';
import type { SystemKVStore } from '../stores/systemKv/SystemKVStore.js';
import type { TeamStore } from '../stores/team/TeamStore.js';
import type { UserRow } from '../stores/user/UserStore.js';
import type { IConfig } from '../types.js';
import {
    cardFallbackDepsFrom,
    isCardFallbackEligible,
    type CardFallbackClients,
} from './cardFallback.js';
import { getTaskbarItems } from './taskbarItems.js';

type TaskbarDeps = Parameters<typeof getTaskbarItems>[1];

export interface UserDetailsDeps {
    config: IConfig;
    clients: CardFallbackClients & TaskbarDeps['clients'];
    stores: TaskbarDeps['stores'] & {
        kv: Pick<SystemKVStore, 'get'>;
        team: Pick<TeamStore, 'getOrgSeat'>;
    };
    services: { oidc: Pick<OIDCService, 'getLinkedProviderForUser'> };
}

// Allowlist of `config.feature_flags` keys the client may read. Anything not
// listed stays server-side, so internal flags cannot leak by accident.
const CLIENT_VISIBLE_FEATURE_FLAGS: ReadonlySet<string> = new Set([
    'create_shortcut',
    'download_directory',
    'prompt_user_when_navigation_away_from_puter',
]);

// Keys that must never leave the server, whoever put them on a payload:
// credentials and single-use tokens, the payment/phone identifiers used for
// verification, the network identity recorded at signup, and anti-abuse
// bookkeeping. The `requires_*_verification` flags stay; the GUI acts on them.
const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
    'password',
    'tmp_password',
    'pass_recovery_token',
    'email_confirm_code',
    'email_confirm_token',
    'change_email_confirm_token',
    'otp_secret',
    'otp_recovery_codes',
    'card_fingerprint',
    'phone',
    'clean_email',
    'signup_ip',
    'signup_ip_forwarded',
    'signup_user_agent',
    'signup_origin',
    'signup_server',
    'audit_metadata',
]);

/**
 * Delete every sensitive key at any depth (`metadata` and `taskbar_items` are
 * nested). Depth-limited and cycle-safe. Runs last over a whole payload.
 */
export const scrubSensitive = (
    value: unknown,
    seen: Set<object> = new Set(),
    depth = 0,
): void => {
    if (depth > 8 || value === null || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
        for (const entry of value) scrubSensitive(entry, seen, depth + 1);
        return;
    }

    for (const key of Object.keys(value as Record<string, unknown>)) {
        if (SENSITIVE_KEYS.has(key)) {
            delete (value as Record<string, unknown>)[key];
            continue;
        }
        scrubSensitive(
            (value as Record<string, unknown>)[key],
            seen,
            depth + 1,
        );
    }
};

// SQL datetimes go out as unix seconds; unparseable values are dropped.
export const toUnixSeconds = (value: unknown): number | undefined => {
    if (!value) return undefined;
    const ms = new Date(value as string | number | Date).getTime();
    return Number.isNaN(ms) ? undefined : Math.round(ms / 1000);
};

/**
 * The account as the client keeps it in `window.user`: what `/whoami` answers
 * and what a sign-in hands back. `isUser` false (an app acting for the user)
 * leaves out the desktop-only parts; trimming fields an app may not see is the
 * caller's job. Not scrubbed: run `scrubSensitive` on the final payload.
 */
export async function buildUserDetails(
    user: UserRow,
    deps: UserDetailsDeps,
    opts: { isUser: boolean; iconSize?: number; noIcons?: boolean },
): Promise<Record<string, unknown>> {
    const { config, clients, stores, services } = deps;
    const { isUser } = opts;
    const oidcOnly = user.password === null;

    // Non-boolean values (e.g. `"true"`) are coerced so the client never has
    // to guess.
    const feature_flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(config.feature_flags ?? {})) {
        if (CLIENT_VISIBLE_FEATURE_FLAGS.has(k)) feature_flags[k] = Boolean(v);
    }

    // Deep-copied (it is decoded JSON) so a scrub edits the payload and not
    // the cached UserRow.
    const metadata = user.metadata
        ? structuredClone(user.metadata)
        : user.metadata;

    const details: Record<string, unknown> = {
        username: user.username,
        uuid: user.uuid,
        email: user.email,
        unconfirmed_email: user.email,
        email_confirmed: user.email_confirmed || user.username === 'admin',
        requires_email_confirmation: user.requires_email_confirmation,
        // The phone number itself is deliberately absent: nothing on the
        // client reads it. Only the verification flag ships.
        requires_phone_verification: user.requires_phone_verification,
        requires_card_verification: user.requires_card_verification,
        // A seat reaches nothing until it replaces its admin's password.
        requires_password_change: user.requires_password_change,
        // The SMS-to-card escape hatch. It ships here because by the time the
        // fallback opens, /send-confirm-phone is past its own rate limit and
        // can no longer say so. Costs no KV read unless the account is
        // phone-gated.
        card_fallback_available: isUser
            ? await isCardFallbackEligible(
                  config,
                  user,
                  async (key) => (await stores.kv.get({ key })).res,
                  cardFallbackDepsFrom(clients),
              )
            : false,
        desktop_bg_url: user.desktop_bg_url,
        desktop_bg_color: user.desktop_bg_color,
        desktop_bg_fit: user.desktop_bg_fit,
        is_temp: user.password === null && user.email === null,
        is_user_token: true,
        // Null until the account asks for a code; never minted here.
        referral_code: user.referral_code,
        oidc_only: oidcOnly,
        otp: !!user.otp_enabled,
        feature_flags,
        created_ts: toUnixSeconds(user.timestamp),
        metadata,
        hasDevAccountAccess: !!user.metadata?.hasDevAccountAccess,
    };

    if (oidcOnly) {
        try {
            const provider = await services.oidc.getLinkedProviderForUser(
                user.id,
            );
            if (provider) {
                const origin = (config.origin ?? '').replace(/\/$/, '');
                details.oidc_revalidate_url = `${origin}/auth/oidc/${provider}/start?flow=revalidate&user_uuid=${encodeURIComponent(user.uuid)}`;
            }
        } catch {
            // OIDC not configured
        }
    }

    if (isUser) {
        // Best-effort: the account still works without them.
        try {
            details.taskbar_items = await getTaskbarItems(
                user,
                {
                    clients,
                    stores,
                    apiBaseUrl: String(config.api_base_url ?? ''),
                    config,
                },
                { iconSize: opts.iconSize, noIcons: opts.noIcons },
            );
        } catch (e) {
            console.warn('[user-details] taskbar_items failed:', e);
            details.taskbar_items = [];
        }

        const directories: Record<string, unknown> = {};
        const nameToProp: Record<string, string> = {
            desktop_uuid: `/${user.username}/Desktop`,
            appdata_uuid: `/${user.username}/AppData`,
            documents_uuid: `/${user.username}/Documents`,
            pictures_uuid: `/${user.username}/Pictures`,
            videos_uuid: `/${user.username}/Videos`,
            trash_uuid: `/${user.username}/Trash`,
        };
        for (const k in nameToProp) {
            directories[nameToProp[k]] = user[k];
        }
        details.directories = directories;
    }

    // The team that pays for the account; every seat restriction keys on it.
    if (isUser && config.teams_enabled === true) {
        try {
            const seat = await stores.team.getOrgSeat(user.id);
            if (seat) {
                details.team = {
                    uid: seat.team_uid,
                    name: seat.team_name ?? null,
                };
            }
        } catch (e) {
            console.warn('[user-details] team lookup failed:', e);
        }
    }

    const lastActivityTs = toUnixSeconds(user.last_activity_ts);
    if (lastActivityTs !== undefined) {
        details.last_activity_ts = lastActivityTs;
    }

    return details;
}
