import { HttpError } from '../../core/http/HttpError.js';
import { PuterController } from '../types.js';

/**
 * System-level endpoints — health, version, contact.
 *
 * These are all low-risk, authenticated or not, and mostly stateless.
 */
export class SystemController extends PuterController {
    constructor(config, clients, stores, services, drivers) {
        super(config, clients, stores, services, drivers);
    }

    registerRoutes(
        /** @type {import('../../core/http/PuterRouter.js').PuterRouter} */
        router,
    ) {
        // ── Healthcheck ─────────────────────────────────────────────
        // Delegates to ServerHealthService for the real check-based
        // status. Returns `{ ok: true }` when all registered checks pass,
        // or `{ ok: false, failed: [...] }` + 503 when any fail or the
        // server is draining.
        router.get('/healthcheck', { subdomain: '*' }, async (_req, res) => {
            const health = this.services.health;
            if (!health || typeof health.getStatus !== 'function') {
                // Fallback for boot ordering / missing service.
                return res.send('ok');
            }
            const status = await health.getStatus();
            if (!status.ok) return res.status(503).json(status);
            return res.json(status);
        });

        // ── Version ─────────────────────────────────────────────────

        router.get('/version', { subdomain: '*' }, (_req, res) => {
            const version =
                this.config.version ??
                process.env.npm_package_version ??
                'unknown';
            const parts = String(version).split('.');
            res.json({
                version,
                major: parts[0] ? Number(parts[0]) : null,
                minor: parts[1] ? Number(parts[1]) : null,
                patch: parts[2] ? Number(parts[2]) : null,
            });
        });

        // ── Contact us ──────────────────────────────────────────────

        router.post(
            '/contactUs',
            {
                subdomain: 'api',
                requireUserActor: true,
                rateLimit: {
                    scope: 'contact-us',
                    limit: 10,
                    window: 15 * 60_000,
                    key: 'user',
                },
            },
            async (req, res) => {
                const { message } = req.body ?? {};
                if (!message || typeof message !== 'string') {
                    throw new HttpError(400, '`message` is required');
                }
                if (message.length > 100_000) {
                    throw new HttpError(
                        400,
                        '`message` is too long (max 100,000 characters)',
                    );
                }

                // Persist to feedback table for durability
                try {
                    await this.clients.db.write(
                        'INSERT INTO `feedback` (`user_id`, `message`) VALUES (?, ?)',
                        [req.actor.user.id, message],
                    );
                } catch (e) {
                    console.warn('[contactUs] feedback insert failed:', e);
                }

                // Send to support email
                const supportEmail =
                    this.config.support_email ?? 'support@puter.com';
                if (this.clients.email && req.actor.user?.email) {
                    try {
                        await this.clients.email.sendRaw({
                            to: supportEmail,
                            replyTo: req.actor.user.email,
                            subject: `Contact from ${req.actor.user.username}`,
                            text: message,
                        });
                    } catch (e) {
                        console.warn('[contactUs] email send failed:', e);
                    }
                }

                res.json({});
            },
        );

        // ── GET /whoarewe ───────────────────────────────────────────

        router.get('/whoarewe', {}, (_req, res) => {
            res.json({
                name: 'Puter',
                version: this.config.version ?? null,
                environment: this.config.env ?? 'prod',
            });
        });

        // ── GET /lsmod ──────────────────────────────────────────────
        // Enumerates driver interfaces and their implementors.

        router.get(
            '/lsmod',
            { subdomain: 'api', requireAuth: true },
            (_req, res) => {
                const interfaces = {};
                for (const [key, driver] of Object.entries(this.drivers)) {
                    const ifaceName = driver?.driverInterface;
                    if (!ifaceName) continue;
                    const driverName = driver.driverName ?? key;
                    if (!interfaces[ifaceName]) {
                        interfaces[ifaceName] = { implementors: {} };
                    }
                    interfaces[ifaceName].implementors[driverName] = {
                        isDefault: Boolean(driver.isDefault),
                    };
                }
                res.json({ interfaces });
            },
        );
    }

    onServerStart() {}
    onServerPrepareShutdown() {
        globalThis.__puter_draining = true;
    }
    onServerShutdown() {}
}
