import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import type { AuthService } from '../../services/auth/AuthService.js';
import type { NotificationService } from '../../services/notification/NotificationService.js';
import { PuterController } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyStore = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyService = any;

const SHARE_TOKEN_TYPE = 'share';
const SHARE_TOKEN_EXPIRY = '14d';

/**
 * Share link endpoints — check, apply, and request access to pending
 * shares. The main `POST /share` creation endpoint is also here.
 *
 * Shares are permission grants addressed to an email. When the
 * recipient doesn't have a Puter account yet, the share row lives in
 * the `share` table until they sign up and apply it. When they DO have
 * an account, permissions are granted immediately and no row is stored.
 */
export class ShareController extends PuterController {

    get #shareStore (): AnyStore { return this.stores.share; }
    get #userStore (): AnyStore { return this.stores.user; }
    get #appStore (): AnyStore { return this.stores.app; }
    get #permService (): AnyService { return this.services.permission; }
    get #aclService (): AnyService { return this.services.acl; }
    get #tokenService (): AnyService { return this.services.token; }
    get #authService (): AuthService { return this.services.auth as unknown as AuthService; }
    get #notifService (): NotificationService | undefined { return this.services.notification as unknown as NotificationService | undefined; }

    registerRoutes (router: PuterRouter): void {
        const api = { subdomain: 'api' } as const;

        router.post('/sharelink/check', api, this.#check);
        router.post('/sharelink/apply', { ...api, requireAuth: true }, this.#apply);
        router.post('/sharelink/request', { ...api, requireAuth: true }, this.#request);
        router.post('/share', { ...api, requireAuth: true }, this.#share);
    }

    // ── POST /sharelink/check ───────────────────────────────────────
    // Public — verify a share token from an email link.

    #check = async (req: Request, res: Response): Promise<void> => {
        const token = req.body?.token;
        if ( typeof token !== 'string' || token.length === 0 ) {
            throw new HttpError(400, 'Missing `token`');
        }

        let decoded: { uid?: string; type?: string };
        try {
            decoded = this.#tokenService.verify(SHARE_TOKEN_TYPE, token);
        } catch {
            throw new HttpError(400, 'Invalid or expired share token');
        }
        if ( decoded.type !== `token:${SHARE_TOKEN_TYPE}` || ! decoded.uid ) {
            throw new HttpError(400, 'Invalid share token');
        }

        const share = await this.#shareStore.getByUid(decoded.uid);
        if ( ! share ) throw new HttpError(404, 'Share not found or expired');

        res.json({
            $: 'api:share',
            uid: share.uid,
            email: share.recipient_email,
        });
    };

    // ── POST /sharelink/apply ───────────────────────────────────────
    // Auth required — apply a pending share's permissions to the caller.

    #apply = async (req: Request, res: Response): Promise<void> => {
        const uid = req.body?.uid;
        if ( typeof uid !== 'string' ) throw new HttpError(400, 'Missing `uid`');

        const actor = req.actor;
        if ( ! actor?.user ) throw new HttpError(401, 'Unauthorized');

        const share = await this.#shareStore.getByUid(uid);
        if ( ! share ) throw new HttpError(404, 'Share not found or expired');

        // Issuer must still exist
        const issuer = await this.#userStore.getById(share.issuer_user_id);
        if ( ! issuer ) throw new HttpError(410, 'Share expired — issuer account gone');

        // Email must be confirmed
        if ( actor.user.requires_email_confirmation && ! actor.user.email_confirmed ) {
            throw new HttpError(403, 'Please confirm your email before applying shares');
        }

        // Recipient email must match
        if ( ! actor.user.email || actor.user.email.toLowerCase() !== share.recipient_email.toLowerCase() ) {
            throw new HttpError(403, 'This share was sent to a different email address');
        }

        // Grant each permission
        const data = (share.data ?? {}) as { permissions?: Array<{ permission: string; extra?: Record<string, unknown> }> };
        for ( const perm of data.permissions ?? [] ) {
            try {
                if ( perm.permission.startsWith('fs:') ) {
                    // FS permissions use ACL
                    await this.#aclService.setUserUser(issuer.id, actor.user.id, perm.permission, perm.extra);
                } else {
                    await this.#permService.grantUserUser(issuer.id, actor.user.id, perm.permission, perm.extra);
                }
            } catch ( err ) {
                console.warn('[share] grant failed for', perm.permission, err);
            }
        }

        // Share consumed — delete it
        await this.#shareStore.deleteByUid(uid);

        res.json({ $: 'api:status-report', status: 'success' });
    };

    // ── POST /sharelink/request ─────────────────────────────────────
    // Auth required — notify the issuer that someone is requesting access.

    #request = async (req: Request, res: Response): Promise<void> => {
        const uid = req.body?.uid;
        if ( typeof uid !== 'string' ) throw new HttpError(400, 'Missing `uid`');

        const actor = req.actor;
        if ( ! actor?.user ) throw new HttpError(401, 'Unauthorized');

        const share = await this.#shareStore.getByUid(uid);
        if ( ! share ) throw new HttpError(404, 'Share not found or expired');

        const issuer = await this.#userStore.getById(share.issuer_user_id);
        if ( ! issuer ) throw new HttpError(410, 'Share expired — issuer account gone');

        // If caller IS the intended recipient (confirmed email matches),
        // they should just /apply instead.
        if ( actor.user.email_confirmed && actor.user.email?.toLowerCase() === share.recipient_email.toLowerCase() ) {
            throw new HttpError(400, 'You are the intended recipient — use /sharelink/apply instead');
        }

        // Notify the issuer
        if ( this.#notifService ) {
            await this.#notifService.notify([issuer.id], {
                source: 'sharing',
                title: `User ${actor.user.username} is trying to open a share you sent to ${share.recipient_email}`,
                template: 'user-requesting-share',
                fields: {
                    username: actor.user.username,
                    intended_recipient: share.recipient_email,
                    permissions: (share.data as Record<string, unknown>)?.permissions ?? [],
                },
            });
        }

        res.json({ $: 'api:status-report', status: 'success' });
    };

    // ── POST /share ─────────────────────────────────────────────────
    // Auth required — create shares for recipients (users or emails).

    #share = async (req: Request, res: Response): Promise<void> => {
        const actor = req.actor;
        if ( ! actor?.user ) throw new HttpError(401, 'Unauthorized');

        const body = req.body ?? {};
        let recipients = body.recipients;
        let shares = body.shares;
        const dryRun = !!body.dry_run;

        if ( ! recipients ) throw new HttpError(400, 'Missing `recipients`');
        if ( ! shares ) throw new HttpError(400, 'Missing `shares`');
        if ( ! Array.isArray(recipients) ) recipients = [recipients];
        if ( ! Array.isArray(shares) ) shares = [shares];

        // Build the permissions list from share declarations.
        const permissions = this.#resolvePermissions(shares as unknown[]);

        const recipientResults: unknown[] = [];

        for ( const recipient of recipients as unknown[] ) {
            const recipientStr = typeof recipient === 'string' ? recipient.trim() : '';
            if ( ! recipientStr ) {
                recipientResults.push({ $: 'error', message: 'empty recipient' });
                continue;
            }

            try {
                // Try username first
                const targetUser = await this.#userStore.getByUsername(recipientStr)
                    ?? (recipientStr.includes('@') ? await this.#userStore.getByEmail(recipientStr) : null);

                if ( targetUser ) {
                    // Direct grant — user exists
                    if ( ! dryRun ) {
                        for ( const perm of permissions ) {
                            try {
                                if ( perm.permission.startsWith('fs:') ) {
                                    await this.#aclService.setUserUser(actor.user.id, targetUser.id, perm.permission, perm.extra);
                                } else {
                                    await this.#permService.grantUserUser(actor.user.id, targetUser.id, perm.permission, perm.extra);
                                }
                            } catch ( err ) {
                                console.warn('[share] grant to user failed', perm.permission, err);
                            }
                        }

                        // Notify
                        if ( this.#notifService ) {
                            await this.#notifService.notify([targetUser.id], {
                                source: 'sharing',
                                title: `${actor.user.username} shared items with you`,
                                template: 'file-shared-with-you',
                                fields: {
                                    username: actor.user.username,
                                    permissions: permissions.map(p => p.permission),
                                },
                            });
                        }
                    }
                    recipientResults.push({ $: 'api:status-report', status: 'success' });
                } else if ( recipientStr.includes('@') ) {
                    // Email recipient — store pending share
                    if ( ! dryRun ) {
                        const share = await this.#shareStore.create({
                            issuerUserId: actor.user.id,
                            recipientEmail: recipientStr.toLowerCase(),
                            data: {
                                permissions,
                                metadata: body.metadata ?? {},
                            },
                        });

                        // Sign a share token (14-day expiry)
                        const token = this.#tokenService.sign(SHARE_TOKEN_TYPE, {
                            type: `token:${SHARE_TOKEN_TYPE}`,
                            uid: share.uid,
                        }, { expiresIn: SHARE_TOKEN_EXPIRY });

                        // Email the share link
                        const origin = `https://${(this.config as unknown as { domain?: string }).domain ?? 'puter.com'}`;
                        try {
                            await this.clients.email.sendRaw({
                                to: recipientStr,
                                subject: `${actor.user.username} shared something with you on Puter`,
                                html: `<p>${actor.user.username} shared items with you.</p><p><a href="${origin}?share_token=${encodeURIComponent(token)}">Click here to accept</a></p>`,
                            });
                        } catch ( err ) {
                            console.warn('[share] email send failed', err);
                        }
                    }
                    recipientResults.push({ $: 'api:status-report', status: 'success' });
                } else {
                    recipientResults.push({ $: 'error', message: 'User not found' });
                }
            } catch ( err ) {
                recipientResults.push({ $: 'error', message: String(err) });
            }
        }

        const allOk = recipientResults.every((r: unknown) => (r as Record<string, unknown>).status === 'success');
        const anyOk = recipientResults.some((r: unknown) => (r as Record<string, unknown>).status === 'success');

        res.json({
            $: 'api:share',
            $version: 'v0.0.0',
            status: allOk ? 'success' : anyOk ? 'mixed' : 'aborted',
            recipients: recipientResults,
            ...(dryRun ? { dry_run: true } : {}),
        });
    };

    // ── Helpers ──────────────────────────────────────────────────────

    /**
     * Convert share declarations into a flat permission list.
     * v1 supports `fs-share` ({ path, access }) and `app-share` ({ uid, name }).
     */
    #resolvePermissions (shares: unknown[]): Array<{ permission: string; extra?: Record<string, unknown> }> {
        const perms: Array<{ permission: string; extra?: Record<string, unknown> }> = [];

        for ( const share of shares ) {
            if ( !share || typeof share !== 'object' ) continue;
            const s = share as Record<string, unknown>;

            if ( s.$  === 'fs-share' || s.type === 'fs-share' || s.path ) {
                const path = String(s.path ?? '');
                const access = String(s.access ?? 'read');
                if ( path ) {
                    perms.push({ permission: `fs:${path}:${access}` });
                }
            } else if ( s.$ === 'app-share' || s.type === 'app-share' || s.uid || s.name ) {
                const appUid = String(s.uid ?? s.name ?? '');
                if ( appUid ) {
                    perms.push({ permission: `app:uid#${appUid}:access` });
                }
            }
        }

        return perms;
    }
}
