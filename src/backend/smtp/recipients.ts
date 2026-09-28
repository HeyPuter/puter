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

/**
 * The addresses this server will take mail for, in the order offered and
 * without repeats.
 *
 * An address is accepted only when its domain is one of `domains` - that check
 * is the whole reason this server is not an open relay. The local part is
 * passed through exactly as the sender wrote it, because what it names is the
 * ingress endpoint's decision, not this one's.
 */
export const acceptedRecipients = (
    addresses: readonly string[],
    domains: readonly string[],
): string[] => {
    const accepted = domains.map((d) => d.toLowerCase());
    const seen = new Set<string>();
    const out: string[] = [];

    for (const address of addresses) {
        const at = address.lastIndexOf('@');
        if (at <= 0 || at === address.length - 1) continue;
        if (/\s/.test(address)) continue;

        const domain = address.slice(at + 1).toLowerCase();
        if (!accepted.includes(domain)) continue;

        const key = `${address.slice(0, at)}@${domain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(address);
    }
    return out;
};
