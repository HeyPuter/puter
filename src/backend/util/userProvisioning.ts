import { v4 as uuidv4 } from 'uuid';
import type { DatabaseClient } from '../clients/database/DatabaseClient';
import type { GroupStore } from '../stores/group/GroupStore';
import type { UserRow, UserStore } from '../stores/user/UserStore';
import type { IConfig } from '../types';

const DEFAULT_FOLDERS = [
    'Trash',
    'AppData',
    'Desktop',
    'Documents',
    'Pictures',
    'Videos',
    'Public',
] as const;
type FolderName = (typeof DEFAULT_FOLDERS)[number];

/**
 * Creates a user's default FS tree: `/<username>` (home) and the seven
 * standard children (Trash, AppData, Desktop, Documents, Pictures, Videos,
 * Public). Records each folder's `uuid` + `id` on the `user` row so callers
 * can look them up without an extra SELECT.
 *
 * Safe to call once per user (e.g. after signup or during admin bootstrap).
 * Callers should check `user.trash_uuid` / similar up-front if they need
 * idempotency.
 *
 * Folder IDs are resolved by re-SELECTing by UUID rather than inferring them
 * from a multi-row `INSERT`'s single `insertId` return — that approach is
 * engine-dependent (MySQL returns the first inserted id; SQLite returns the
 * last). One extra round-trip, zero ambiguity.
 */
export async function generateDefaultFsentries(
    db: DatabaseClient,
    userStore: UserStore,
    user: UserRow,
): Promise<void> {
    // Idempotency guard: if trash_uuid is already set, the tree exists.
    // Cheap check vs. a redundant INSERT + UPDATE on retries / re-runs.
    if (user.trash_uuid) return;

    const home_uuid = uuidv4();
    const folderUuids: Record<FolderName, string> = {
        Trash: uuidv4(),
        AppData: uuidv4(),
        Desktop: uuidv4(),
        Documents: uuidv4(),
        Pictures: uuidv4(),
        Videos: uuidv4(),
        Public: uuidv4(),
    };
    const ts = Math.floor(Date.now() / 1000);

    // Rows: [uuid, parent_uid, name, path]
    const rows: Array<[string, string | null, string, string]> = [
        [home_uuid, null, user.username, `/${user.username}`],
        ...DEFAULT_FOLDERS.map((name): [string, string, string, string] => [
            folderUuids[name],
            home_uuid,
            name,
            `/${user.username}/${name}`,
        ]),
    ];

    // Each row: uuid, parent_uid, user_id, name, path, created, modified
    // is_dir and immutable are hardcoded to 1.
    const placeholders = rows
        .map(() => '(?, ?, ?, ?, ?, 1, ?, ?, 1)')
        .join(', ');
    const params: unknown[] = [];
    for (const [uuid, parent, name, path] of rows) {
        params.push(uuid, parent, user.id, name, path, ts, ts);
    }

    await db.write(
        `INSERT INTO fsentries
            (uuid, parent_uid, user_id, name, path, is_dir, created, modified, immutable)
         VALUES ${placeholders}`,
        params,
    );

    // Resolve auto-increment IDs by UUID so we can pin them on the user row.
    const folderUuidList = Object.values(folderUuids);
    const idPlaceholders = folderUuidList.map(() => '?').join(', ');
    const idRows = (await db.pread(
        `SELECT id, uuid FROM fsentries WHERE user_id = ? AND uuid IN (${idPlaceholders})`,
        [user.id, ...folderUuidList],
    )) as Array<{ id: number; uuid: string }>;
    const idByUuid = new Map(idRows.map((r) => [String(r.uuid), Number(r.id)]));

    await userStore.update(user.id, {
        trash_uuid: folderUuids.Trash,
        appdata_uuid: folderUuids.AppData,
        desktop_uuid: folderUuids.Desktop,
        documents_uuid: folderUuids.Documents,
        pictures_uuid: folderUuids.Pictures,
        videos_uuid: folderUuids.Videos,
        public_uuid: folderUuids.Public,
        trash_id: idByUuid.get(folderUuids.Trash) ?? null,
        appdata_id: idByUuid.get(folderUuids.AppData) ?? null,
        desktop_id: idByUuid.get(folderUuids.Desktop) ?? null,
        documents_id: idByUuid.get(folderUuids.Documents) ?? null,
        pictures_id: idByUuid.get(folderUuids.Pictures) ?? null,
        videos_id: idByUuid.get(folderUuids.Videos) ?? null,
        public_id: idByUuid.get(folderUuids.Public) ?? null,
    });
}

/**
 * Moves a user from the default *temp* group to the default *user* group.
 * Call after a user's `email_confirmed` flips to 1.
 *
 * Best-effort on both sides: missing temp membership is common (e.g.
 * OIDC signups that come in already-verified), and a failing user-group
 * add shouldn't fail the response — we just log it.
 */
export async function promoteToVerifiedGroup(
    groupStore: GroupStore,
    config: IConfig,
    user: UserRow,
): Promise<void> {
    const tempGroup = config.default_temp_group;
    const userGroup = config.default_user_group;

    if (tempGroup) {
        try {
            await groupStore.removeUsers(tempGroup, [user.username]);
        } catch {
            // Expected when the user was never in the temp group.
        }
    }
    if (userGroup) {
        try {
            await groupStore.addUsers(userGroup, [user.username]);
        } catch (e) {
            console.warn('[verified-group] add to user group failed:', e);
        }
    }
}
