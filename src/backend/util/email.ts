/**
 * Email normalization + block-list check. Stateless — used by
 * AuthController (signup / change-email / save-account).
 *
 *   cleanEmail('foo.bar+tag@gmail.com') === 'foobar@gmail.com'
 *   isBlockedEmail('temp@mailinator.com', ['mailinator.com']) === true
 */

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

/**
 * Providers whose addresses should be canonicalized before comparison.
 * `rules` are added on top of the default `remove_subaddressing`; `rmrules`
 * are subtracted (Yahoo permits `+` in local parts).
 */
const PROVIDERS: Record<string, { rules?: RuleName[]; rmrules?: RuleName[] }> =
    {
        gmail: { rules: ['dots_dont_matter'] },
        icloud: { rules: ['dots_dont_matter'] },
        yahoo: { rmrules: ['remove_subaddressing'] },
    };

const DOMAIN_TO_PROVIDER: Record<string, string> = {
    'gmail.com': 'gmail',
    'googlemail.com': 'gmail',
    'yahoo.com': 'yahoo',
    'yahoo.co.uk': 'yahoo',
    'yahoo.ca': 'yahoo',
    'yahoo.com.au': 'yahoo',
    'icloud.com': 'icloud',
    'me.com': 'icloud',
    'mac.com': 'icloud',
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

    const applied = new Set<RuleName>(['remove_subaddressing']);
    const provider = PROVIDERS[DOMAIN_TO_PROVIDER[parts.domain] ?? ''];
    if (provider) {
        for (const r of provider.rules ?? []) applied.add(r);
        for (const r of provider.rmrules ?? []) applied.delete(r);
    }
    for (const rule of applied) RULES[rule](parts);

    return `${parts.local}@${parts.domain}`;
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
