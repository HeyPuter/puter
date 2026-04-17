import { createHash } from 'node:crypto';
import { Context } from '../../core/context.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterDriver } from '../types.js';

const ENTRI_TOKEN_URL = 'https://api.goentri.com/token';
const ENTRI_POWER_URL = 'https://api.goentri.com/power';

/**
 * Driver exposing the `entri` interface — custom domain management
 * via the Entri third-party DNS service.
 *
 * Lifecycle:
 *   1. Client calls `getConfig({domain, userHostedSite})` — we check
 *      uniqueness, mark the subdomain row `domain = 'in-progress:<domain>'`,
 *      fetch an Entri auth token, and return the config + DNS records
 *      the Entri widget needs.
 *   2. Entri propagates DNS. When done, Entri POSTs to
 *      `/entri/webhook` (handled by `EntriController`), which flips
 *      `in-progress:<domain>` → `<domain>`.
 *   3. Client can call `deleteMapping({domain})` to tear down.
 *
 * Config: `config.entri.applicationId`, `config.entri.secret`.
 */
export class EntriDriver extends PuterDriver {
    readonly driverInterface = 'entri';
    readonly driverName = 'entri';
    readonly isDefault = true;

    // ── Driver methods ──────────────────────────────────────────────

    async getConfig (args: Record<string, unknown>): Promise<unknown> {
        const domain = String(args.domain ?? '').trim();
        const userHostedSite = String(args.userHostedSite ?? '').trim();
        if ( ! domain ) throw new HttpError(400, 'Missing `domain`');
        if ( ! userHostedSite ) throw new HttpError(400, 'Missing `userHostedSite`');

        const cfg = this.#entriConfig();
        if ( ! cfg.applicationId || ! cfg.secret ) {
            throw new HttpError(503, 'Entri integration not configured');
        }

        // Check domain isn't already mapped (or in-progress) for a DIFFERENT subdomain
        const subdomainName = userHostedSite.replace('.puter.site', '');
        const existing = await this.stores.subdomain.getByDomain(domain)
            ?? await this.stores.subdomain.getByDomain(`in-progress:${domain}`);
        if ( existing && existing.subdomain !== subdomainName ) {
            throw new HttpError(409, 'Domain is already in use by another site');
        }

        // Detect root vs subdomain for DNS record shape
        let isRootDomain = true;
        try {
            const parseDomain = (await import('parse-domain')).parseDomain;
            const parsed = parseDomain(domain);
            isRootDomain = ((parsed as { icann?: { subDomains?: string[] } })?.icann?.subDomains?.length ?? 0) === 0;
        } catch {
            // Fall back to root
        }

        const dnsRecords = isRootDomain
            ? [{
                type: 'A',
                host: '@',
                value: '{ENTRI_SERVERS}',
                ttl: 300,
                applicationUrl: userHostedSite,
            }]
            : [{
                type: 'CNAME',
                value: 'power.goentri.com',
                host: '{SUBDOMAIN}',
                ttl: 300,
                applicationUrl: userHostedSite,
            }];

        // Get an Entri auth token
        const tokenRes = await fetch(ENTRI_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                applicationId: cfg.applicationId,
                secret: cfg.secret,
                domain,
            }),
        });
        const tokenData = await tokenRes.json() as { auth_token?: string };
        if ( ! tokenData.auth_token ) {
            throw new HttpError(502, 'Failed to obtain Entri token');
        }

        // Mark subdomain as in-progress
        const row = await this.stores.subdomain.getBySubdomain(subdomainName);
        if ( row ) {
            await this.stores.subdomain.update(row.uuid, { domain: `in-progress:${domain}` });
        }

        return {
            token: tokenData.auth_token,
            applicationId: cfg.applicationId,
            power: true,
            dnsRecords,
            prefilledDomain: domain,
            hostRequired: false,
        };
    }

    async deleteMapping (args: Record<string, unknown>): Promise<unknown> {
        const domain = String(args.domain ?? '').trim();
        if ( ! domain ) throw new HttpError(400, 'Missing `domain`');
        if ( domain.startsWith('in-progress') ) {
            throw new HttpError(400, 'Invalid domain');
        }

        const cfg = this.#entriConfig();
        if ( ! cfg.applicationId || ! cfg.secret ) {
            throw new HttpError(503, 'Entri integration not configured');
        }

        // Find the subdomain row by domain (or in-progress variant)
        const row = await this.stores.subdomain.getByDomain(domain)
            ?? await this.stores.subdomain.getByDomain(`in-progress:${domain}`);
        if ( ! row ) throw new HttpError(404, 'Domain mapping not found');

        // Clear the domain field
        await this.stores.subdomain.update(row.uuid, { domain: null });

        // Best-effort Entri API delete — even for in-progress domains
        const errors: string[] = [];
        try {
            const tokenRes = await fetch(ENTRI_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    applicationId: cfg.applicationId,
                    secret: cfg.secret,
                }),
            });
            const { auth_token } = await tokenRes.json() as { auth_token?: string };

            const delRes = await fetch(ENTRI_POWER_URL, {
                method: 'DELETE',
                headers: {
                    applicationId: cfg.applicationId,
                    Authorization: `Bearer ${auth_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ domain }),
            });
            if ( delRes.status !== 200 ) {
                errors.push(await delRes.text());
            }
        } catch ( err ) {
            errors.push(String(err));
        }

        return { ok: true, errors };
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async fullyRegistered (_args: Record<string, unknown>): Promise<unknown> {
        // Stub — kept for interface compatibility. Fill in when Entri-side
        // confirmation is needed.
        return { ok: true };
    }

    // ── Webhook helper (called by EntriController) ──────────────────

    /**
     * Verify the Entri webhook signature and flip `in-progress:<domain>`
     * to the real domain on the subdomain row.
     */
    async handleWebhook (body: Record<string, unknown>, signature: string | undefined): Promise<{ ok: boolean; message?: string }> {
        const cfg = this.#entriConfig();
        if ( ! cfg.secret ) return { ok: false, message: 'Not configured' };

        const expected = createHash('sha256')
            .update(String(body.id ?? '') + cfg.secret)
            .digest('hex');
        if ( signature !== expected ) {
            return { ok: false, message: 'Invalid signature' };
        }

        const data = body.data as Record<string, unknown> | undefined;
        if ( ! data?.records_propagated ) return { ok: true };

        const propagated = data.records_propagated as Array<{ type?: string }>;
        const isRoot = propagated[0]?.type === 'A';

        const realDomain = (isRoot ? '' : `${body.subdomain}.`) + String(body.domain ?? '');
        if ( ! realDomain ) return { ok: true };

        // Find rows with in-progress domain and flip
        const rows = await this.stores.subdomain.listByDomain(`in-progress:${realDomain}`);
        for ( const row of rows ) {
            await this.stores.subdomain.update(row.uuid, { domain: realDomain });
        }

        return { ok: true };
    }

    // ── Config ──────────────────────────────────────────────────────

    #entriConfig (): { applicationId?: string; secret?: string } {
        return (this.config as unknown as { entri?: { applicationId?: string; secret?: string } }).entri ?? {};
    }
}
