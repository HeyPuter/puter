import type { Actor } from '../../core/actor.js';
import type { FSEntry } from '../../stores/fs/FSEntry.js';
import type { FSEntryStore } from '../../stores/fs/FSEntryStore.js';
import type { PermissionService } from '../permission/PermissionService.js';

/**
 * Synthesize the listing for the virtual root `/`. There is no fsentry row
 * at `/` — instead root is a virtual aggregate of user-directory entries
 * the actor can see: the actor's own home plus any other users' homes
 * granted via permission issuers (i.e. users that have shared something
 * with this actor). Mirrors v1's `LLListUsers`.
 */
export async function listRootEntries(
    actor: Actor,
    fsEntryStore: FSEntryStore,
    permissionService: PermissionService,
): Promise<FSEntry[]> {
    const entries: FSEntry[] = [];
    const seenPaths = new Set<string>();

    const pushByUsername = async (username: string | undefined) => {
        if (!username) return;
        const path = `/${username}`;
        if (seenPaths.has(path)) return;
        seenPaths.add(path);
        const entry = await fsEntryStore.getEntryByPath(path);
        if (entry) entries.push(entry);
    };

    await pushByUsername(actor.user.username);

    const userId = actor.user.id;
    if (typeof userId === 'number') {
        const issuers = await permissionService.listUserPermissionIssuers({
            id: userId,
        });
        for (const issuer of issuers) {
            if (!issuer) continue;
            await pushByUsername(issuer.username);
        }
    }

    return entries;
}
