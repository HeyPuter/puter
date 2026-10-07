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
 * Email normalization + block-list check. Stateless — used by AuthController
 * (signup / change-email / save-account).
 *
 * CleanEmail('foo.bar+tag@gmail.com') === 'foobar@gmail.com'
 * isBlockedEmail('temp@mailinator.com', ['mailinator.com']) === true
 */

import validator from 'validator';

type RuleName = 'dots_dont_matter' | 'remove_subaddressing';

interface Parts {
    local: string;
    domain: string;
}

const RULES: Record<RuleName, (p: Parts) => void> = {
    dots_dont_matter: (p) => {
        p.local = p.local.replace(/\./g, '');
    },
    remove_subaddressing: (p) => {
        p.local = p.local.split('+')[0];
    },
};

/** Rules each provider's semantics allow. Unlisted domains get none. */
const PROVIDERS: Record<string, { rules: RuleName[] }> = {
    gmail: { rules: ['dots_dont_matter', 'remove_subaddressing'] },
    // Dots are significant at Apple: `j.smith@` and `jsmith@` are two mailboxes.
    icloud: { rules: ['remove_subaddressing'] },
    outlook: { rules: ['remove_subaddressing'] },
    proton: { rules: ['remove_subaddressing'] },
    fastmail: { rules: ['remove_subaddressing'] },
    zoho: { rules: ['remove_subaddressing'] },
    yandex: { rules: ['remove_subaddressing'] },
    // Listed to record the finding: yahoo makes `+` significant, using `-`.
    yahoo: { rules: [] },
};

/** `brand.tld` for each whitespace-separated tld. */
const regional = (brand: string, tlds: string): string[] =>
    tlds
        .split(/\s+/)
        .filter(Boolean)
        .map((tld) => `${brand}.${tld}`);

/** Microsoft's consumer domains, regional ones included; one mailbox system. */
const MICROSOFT_DOMAINS = [
    'msn.com',
    'passport.com',
    'windowslive.com',
    ...regional(
        'outlook',
        `com ae at be bg ch cl co co.id co.il co.in co.jp co.kr co.nz co.th co.uk
        com.ar com.au com.br com.co com.mx com.my com.pe com.ph com.sg com.tr
        com.vn cz de dk ee eg es fi fr gr hk hr hu ie in it jp kr lt lv my nl no
        nz ph pk pl pt qa ro rs ru sa se sg si sk tw ua vn`,
    ),
    ...regional(
        'hotmail',
        `com at be ca ch cl co.il co.in co.jp co.kr co.nz co.th co.uk co.za
        com.ar com.au com.br com.hk com.mx com.tr com.tw com.vn cz de dk es fi
        fr gr hu ie it my nl no ph pt se sg sk`,
    ),
    ...regional(
        'live',
        `com at be ca ch cl cn co.kr co.uk co.za com.ar com.au com.mx com.my
        com.ph com.pt com.sg de dk fi fr hk ie in it jp nl no ru se`,
    ),
];

const DOMAIN_TO_PROVIDER: Record<string, string> = {
    'gmail.com': 'gmail',
    'googlemail.com': 'gmail',
    'icloud.com': 'icloud',
    'me.com': 'icloud',
    'mac.com': 'icloud',
    ...Object.fromEntries(MICROSOFT_DOMAINS.map((d) => [d, 'outlook'])),
    'proton.me': 'proton',
    'protonmail.com': 'proton',
    'protonmail.ch': 'proton',
    'pm.me': 'proton',
    'fastmail.com': 'fastmail',
    'fastmail.fm': 'fastmail',
    'zoho.com': 'zoho',
    'zohomail.com': 'zoho',
    'zoho.eu': 'zoho',
    'zohomail.eu': 'zoho',
    'zoho.in': 'zoho',
    'zohomail.in': 'zoho',
    'yandex.com': 'yandex',
    'yandex.ru': 'yandex',
    'yandex.by': 'yandex',
    'yandex.kz': 'yandex',
    'yandex.ua': 'yandex',
    'ya.ru': 'yandex',
    'yahoo.com': 'yahoo',
    'yahoo.co.uk': 'yahoo',
    'yahoo.ca': 'yahoo',
    'yahoo.com.au': 'yahoo',
};

/** Aliases that resolve to the same inbox on the provider side. */
const DOMAIN_NONDISTINCT: Record<string, string> = {
    'googlemail.com': 'gmail.com',
};

/**
 * Canonical form used for the `user.clean_email` column and for duplicate
 * detection. Lowercases, collapses nondistinct domains, strips provider-
 * insignificant characters.
 */
export function cleanEmail(email: string): string {
    const lower = email.toLowerCase();
    const [localRaw, domainRaw] = lower.split('@');
    if (!domainRaw) return lower;

    const parts: Parts = {
        local: localRaw,
        domain: DOMAIN_NONDISTINCT[domainRaw] ?? domainRaw,
    };

    // Nothing is assumed about a domain we don't know: lowercasing only.
    const provider = PROVIDERS[DOMAIN_TO_PROVIDER[parts.domain] ?? ''];
    for (const rule of provider?.rules ?? []) RULES[rule](parts);

    return `${parts.local}@${parts.domain}`;
}

/** Storage gate; `isEmail` alone throws on non-strings and passes quoted parts. */
export function isStorableEmail(email: unknown): boolean {
    return (
        typeof email === 'string' &&
        !/["<>]/u.test(email) &&
        validator.isEmail(email)
    );
}

/** Strips `+` on any domain. For abuse decisions only, never for identity. */
export function abuseKey(email: string): string {
    const [local, domain] = cleanEmail(email).split('@');
    return domain ? `${local.split('+')[0]}@${domain}` : local;
}

/** Whether we have asserted how this domain treats its own local parts. */
export function isProviderCanonicalized(email: string): boolean {
    const domain = email.toLowerCase().split('@')[1] ?? '';
    return Boolean(DOMAIN_TO_PROVIDER[DOMAIN_NONDISTINCT[domain] ?? domain]);
}

/**
 * Returns true when the (cleaned) email matches any of the blocked domain
 * suffixes. Suffix-match so `mailinator.com` blocks `foo@bar.mailinator.com`.
 */
export function isBlockedEmail(
    email: string,
    blockedDomains: readonly string[] | undefined,
): boolean {
    if (!blockedDomains || blockedDomains.length === 0) return false;
    const clean = cleanEmail(email);
    return blockedDomains.some((suffix) => clean.endsWith(suffix));
}
