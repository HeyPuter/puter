import type { puterClients } from '../../clients/index.js';
import type { IExtensionClientInstances } from '../../clients/types.js';
import type { Actor } from '../../core/actor.js';
import { HttpError } from '../../core/http/HttpError.js';
import type { puterServices } from '../../services/index.js';
import type { IExtensionServiceInstances } from '../../services/types.js';
import type { puterStores } from '../../stores/index.js';
import type { IExtensionStoreInstances } from '../../stores/types.js';
import type { LayerInstances } from '../../types.js';

export interface UserAppTokenLayers {
    clients: LayerInstances<typeof puterClients> & IExtensionClientInstances;
    stores: LayerInstances<typeof puterStores> & IExtensionStoreInstances;
    services: LayerInstances<typeof puterServices> & IExtensionServiceInstances;
}

/**
 * Mint an app-under-user token for `actor` against an app named by uid or by
 * origin. An origin with no app row yet gets one created on the spot. Shared by
 * the `/auth/get-user-app-token` route and the magic-link consume page, which
 * signs a user in and hands the opener a token in one step.
 */
export const issueUserAppToken = async (
    layers: UserAppTokenLayers,
    actor: Actor,
    target: { appUid?: string; origin?: string },
): Promise<{ token: string; app_uid: string }> => {
    const { clients, stores, services } = layers;
    let appUid = target.appUid;
    const origin = target.origin;
    const resolvedFromOrigin = !appUid && !!origin;
    if (!appUid && origin) {
        appUid = await services.auth.appUidFromOrigin(origin);
    }
    if (!appUid) {
        throw new HttpError(400, 'Missing `app_uid` or `origin`', {
            legacyCode: 'bad_request',
        });
    }

    let app = await stores.app.getByUid(appUid);
    if (!app && resolvedFromOrigin) {
        // Hosted-subdomain origins get the site owner stamped as the
        // app's creator at bootstrap; external origins stay unowned.
        const ownerUserId = await services.auth.subdomainOwnerIdFromOrigin(
            origin!,
        );
        app = await stores.app.createFromOrigin(appUid, origin!, {
            ownerUserId,
        });
        // An origin's uid is a deterministic uuidv5, so a deleted app
        // may leave grants behind that would otherwise attach to the
        // app whoever controls the origin now has just claimed.
        await services.appPermission.withdrawAppDataGrants(
            appUid,
            'uid reused by a new app',
        );
    }
    if (!app) {
        throw new HttpError(404, `App ${appUid} does not exist`, {
            legacyCode: 'not_found',
        });
    }

    const userPermGrantPromise = services.permission.grantUserAppPermission(
        actor,
        appUid,
        'flag:app-is-authenticated',
        {},
        {},
    );

    const tokenPromise = services.auth.getUserAppToken(actor, appUid);

    const missingFSPathPromise = (async () => {
        const username = actor.user?.username;
        const userId = actor.user?.id;
        if (username && userId) {
            await services.fs.mkdir(userId, {
                path: `/${username}/AppData/${appUid}`,
                createMissingParents: true,
                thumbnail: (app as { icon?: string | null }).icon ?? null,
            } as never);
        }
    })();

    const [, token] = await Promise.all([
        userPermGrantPromise,
        tokenPromise,
        missingFSPathPromise,
    ]);

    try {
        const a = app as {
            id?: number;
            uid?: string;
            index_url?: string | null;
            owner_user_id?: number | null;
            name?: string | null;
        };
        clients.event?.emit(
            'puter.app.authenticated' as never,
            {
                app_uid: appUid,
                app: {
                    id: a.id,
                    uid: a.uid,
                    index_url: a.index_url ?? null,
                    owner_user_id: a.owner_user_id ?? null,
                    name: a.name ?? null,
                },
                user_id: actor.user?.id ?? null,
            } as never,
            {},
        );
    } catch {
        // Best-effort analytics hook.
    }

    return { token, app_uid: appUid };
};
