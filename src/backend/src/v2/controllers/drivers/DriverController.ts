import type { Request, Response } from 'express';
import { HttpError } from '../../core/http/HttpError.js';
import { Controller, Get, Post } from '../../core/http/decorators.js';
import { PuterController } from '../types.js';
import type { DriverRegistry, DriverCallContext } from '../../drivers/DriverRegistry.js';
import type { PermissionService } from '../../services/permission/PermissionService.js';
import type { MeteringService } from '../../services/metering/MeteringService.js';

/**
 * Exposes the driver RPC interface over HTTP. This is the universal
 * gateway for AI, CRUD, and any other driver-backed functionality.
 *
 * Wire-compatible with v1's `/drivers/call` request/response shape so
 * existing clients (puter-js SDK, GUI, apps) keep working.
 *
 * The `driverRegistry` is populated by `PuterServer` during boot from
 * both built-in drivers and extension-registered drivers.
 */
@Controller('/drivers')
export class DriverController extends PuterController {

    private get driverRegistry (): DriverRegistry {
        // The registry is attached to the server instance and passed
        // to controllers via services. See PuterServer wiring.
        const reg = (this.services as Record<string, unknown>).__driverRegistry;
        if ( ! reg ) throw new Error('DriverController: driverRegistry not wired');
        return reg as DriverRegistry;
    }

    private get permService (): PermissionService {
        return this.services.permission as unknown as PermissionService;
    }

    private get meteringService (): MeteringService {
        return this.services.metering as unknown as MeteringService;
    }

    /**
     * Universal driver call endpoint.
     *
     * Request shape (v1-compatible):
     * ```json
     * {
     *   "interface": "puter-chat-completion",
     *   "method": "complete",
     *   "driver": "openai-completion",   // optional — uses default if omitted
     *   "args": { ... },
     *   "test_mode": false               // optional
     * }
     * ```
     *
     * Response shape:
     * ```json
     * {
     *   "success": true,
     *   "result": { ... },
     *   "service": { "name": "openai-completion" }
     * }
     * ```
     */
    @Post('/call', { subdomain: 'api', requireAuth: true })
    async call (req: Request, res: Response): Promise<void> {
        const {
            interface: ifaceName,
            method,
            driver: driverName,
            args = {},
            test_mode: testMode = false,
        } = req.body ?? {};

        if ( ! ifaceName || typeof ifaceName !== 'string' ) {
            throw new HttpError(400, 'Missing or invalid `interface`');
        }
        if ( ! method || typeof method !== 'string' ) {
            throw new HttpError(400, 'Missing or invalid `method`');
        }

        // Resolve driver
        const driver = this.driverRegistry.resolve(ifaceName, driverName);
        if ( ! driver ) {
            const resolvedName = driverName ?? this.driverRegistry.getDefault(ifaceName);
            throw new HttpError(404, `Driver not found: ${ifaceName}:${resolvedName ?? '(no default)'}`);
        }

        // Check method exists
        const fn = driver[method];
        if ( typeof fn !== 'function' ) {
            throw new HttpError(404, `Method '${method}' not found on driver '${ifaceName}'`);
        }

        // Resolve the driver name for permission/metering keys
        const resolvedDriverName = (driver as Record<string, unknown>).driverName
            ?? (Object.getPrototypeOf(driver) as Record<string, unknown>).__driverName
            ?? driverName
            ?? 'unknown';

        // Permission check
        if ( req.actor ) {
            const permKey = `service:${resolvedDriverName}:ii:${ifaceName}`;
            const hasPermission = await this.permService.check(req.actor, permKey);
            if ( ! hasPermission ) {
                throw new HttpError(403, `Permission denied for ${ifaceName}:${method}`, {
                    legacyCode: 'forbidden',
                });
            }
        }

        // Build call context
        const callCtx: DriverCallContext = {
            actor: req.actor,
            test_mode: Boolean(testMode),
        };

        // Invoke the driver method
        const result = await (fn as Function).call(driver, args, callCtx);

        // Metering (fire-and-forget — don't block the response)
        if ( req.actor && ! testMode ) {
            try {
                // MeteringService.trackUsage is async but we don't await
                void (this.meteringService as unknown as { trackUsage?: Function })
                    ?.trackUsage?.(req.actor, {
                        usageType: `${ifaceName}:${method}`,
                        usageAmount: 1,
                    });
            } catch {
                // Metering failure shouldn't break the driver call
            }
        }

        res.json({
            success: true,
            result,
            service: { name: resolvedDriverName },
        });
    }

    /**
     * List all registered driver interfaces and their available implementations.
     */
    @Get('/list-interfaces', { subdomain: 'api', requireAuth: true })
    async listInterfaces (_req: Request, res: Response): Promise<void> {
        const interfaces = this.driverRegistry.listInterfaces();
        const result: Record<string, { drivers: string[]; default: string | undefined }> = {};

        for ( const iface of interfaces ) {
            result[iface] = {
                drivers: this.driverRegistry.listDrivers(iface),
                default: this.driverRegistry.getDefault(iface),
            };
        }

        res.json(result);
    }

    /**
     * Query driver usage for the current actor.
     */
    @Get('/usage', { subdomain: 'api', requireAuth: true })
    async usage (req: Request, res: Response): Promise<void> {
        if ( ! req.actor ) {
            throw new HttpError(401, 'Authentication required');
        }

        // Delegate to metering service for usage data
        // The exact shape depends on how MeteringService exposes usage queries.
        // For now, return a placeholder that matches v1's expectations.
        const usageData = await (this.meteringService as unknown as {
            getDriverUsage?: (actor: unknown) => Promise<unknown>;
        })?.getDriverUsage?.(req.actor) ?? {};

        res.json(usageData);
    }
}
