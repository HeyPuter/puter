import { PermissionUtil } from '../permission/permissionUtil.js';
import type { LayerInstances } from '../../types.js';
import type { puterStores } from '../../stores/index.js';
import type { puterServices } from '../index.js';
import { PuterService } from '../types.js';

/**
 * Permission rewriter for the `site:*` namespace — maps `site:<name>:mode`
 * to the uid form. Ported from v1 PuterSiteService.
 *
 * The v1 `in-site` implicator for SiteActorType is not ported — v2 serves
 * hosted sites through the PuterSite middleware without a dedicated site
 * actor type, so there's no callsite that could benefit from an implicit
 * grant.
 */
export class SubdomainPermissionService extends PuterService {
    declare protected stores: LayerInstances<typeof puterStores>;
    declare protected services: LayerInstances<typeof puterServices>;

    override onServerStart(): void {
        const permissions = this.services.permission;
        const subdomainStore = this.stores.subdomain;

        // SubdomainStore.getBySubdomain caches (60m + 60s negative cache),
        // and renames invalidate the old key via the store's update path.
        permissions.registerRewriter({
            id: 'site-name-to-uid',
            matches: (permission: string) => {
                if (!permission.startsWith('site:')) return false;
                const [, specifier] = PermissionUtil.split(permission);
                return Boolean(specifier && !specifier.startsWith('uid#'));
            },
            rewrite: async (permission: string): Promise<string> => {
                const [prefix, name, ...rest] =
                    PermissionUtil.split(permission);
                const row = (await subdomainStore.getBySubdomain(name)) as {
                    uuid?: string;
                } | null;
                if (!row?.uuid) return permission;
                return PermissionUtil.join(prefix, `uid#${row.uuid}`, ...rest);
            },
        });
    }
}
