import { posix as pathPosix } from 'node:path';
import { statfs } from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import {
    FSEntry,
    FSEntryCreateInput,
    FSEntrySubdomain,
    PendingUploadCreateInput,
    PendingUploadSession,
} from './FSEntry.js';
import { runWithConcurrencyLimit } from '../../util/concurrency.js';
import {
    normalizePendingUploadSession,
    PendingUploadSessionStatus,
    toPendingUploadSession,
    toPendingUploadSessionExpiresAtSeconds,
    toPendingUploadSessionKey,
    withPendingUploadSessionStatus,
} from './pendingUploadSessionHelpers.js';
import type {
    FSEntryRow,
    NormalizedEntryWrite,
    ReadEntriesByPathsOptions,
} from './types.js';
import { HttpError } from '../../core/http/HttpError.js';
import { PuterStore } from '../types.js';
import type { LayerInstances } from '../../types.js';
import type { puterStores } from '../index.js';

const ENTRY_CACHE_TTL_SECONDS = 60;
const BULK_QUERY_CHUNK_SIZE = 200;
const DEFAULT_DB_CHUNK_CONCURRENCY = 4;

/**
 * Store backing the `fsentries` table. Owns DB CRUD over filesystem entries,
 * Redis caching keyed by uuid/path/id, and pending-upload-session state in
 * the system KV store. Constructed by the store registry; depends on `kv`.
 */
export class FSEntryStore extends PuterStore {
    declare protected stores: LayerInstances<typeof puterStores>;

    #insertIgnoreIntoFsentriesSql(): string {
        return this.clients.db.case({
            sqlite: 'INSERT OR IGNORE INTO fsentries',
            otherwise: 'INSERT IGNORE INTO fsentries',
        });
    }

    // JSON aggregation of associated subdomain rows, keyed on fsentries.id.
    // SQLite uses `json_group_array` + `json_object`; MySQL/MariaDB use
    // `JSON_ARRAYAGG` + `JSON_OBJECT`. Correlated subquery keeps the row
    // count 1:1 with fsentries and avoids a GROUP BY on the outer query.
    #subdomainsAggSql(): string {
        return this.clients.db.case({
            sqlite: `(
                SELECT json_group_array(
                    json_object('uuid', sd.uuid, 'subdomain', sd.subdomain)
                )
                FROM subdomains sd
                WHERE sd.root_dir_id = fsentries.id
            )`,
            otherwise: `(
                SELECT JSON_ARRAYAGG(
                    JSON_OBJECT('uuid', sd.uuid, 'subdomain', sd.subdomain)
                )
                FROM subdomains sd
                WHERE sd.root_dir_id = fsentries.id
            )`,
        });
    }

    // Projection shared by every read path: all fsentries columns plus the
    // aggregated subdomains JSON aliased to `subdomains_agg`. Callers append
    // their own `FROM fsentries ...` tail.
    #selectFsentriesColumns(): string {
        return `fsentries.*, ${this.#subdomainsAggSql()} AS subdomains_agg`;
    }

    #parseSubdomainsAgg(
        raw: unknown,
    ): Array<{ uuid: string; subdomain: string }> {
        if (raw === null || raw === undefined) {
            return [];
        }
        let parsed: unknown = raw;
        if (typeof raw === 'string') {
            if (raw.length === 0) {
                return [];
            }
            try {
                parsed = JSON.parse(raw);
            } catch {
                return [];
            }
        }
        if (!Array.isArray(parsed)) {
            return [];
        }
        const result: Array<{ uuid: string; subdomain: string }> = [];
        for (const item of parsed) {
            if (item === null || typeof item !== 'object') {
                continue;
            }
            const record = item as Record<string, unknown>;
            if (
                typeof record.uuid !== 'string' ||
                typeof record.subdomain !== 'string'
            ) {
                continue;
            }
            result.push({ uuid: record.uuid, subdomain: record.subdomain });
        }
        return result;
    }

    // Static hosting for user sites lives at `*.{static_hosting_domain}`
    // (typically `puter.site`). Workers deploy as subdomain rows prefixed
    // `workers.puter.<name>` and are exposed at `<name>.puter.work` — that
    // mapping is hardcoded in `WorkerDriver`, mirrored here so the URL we
    // return matches the deployment domain.
    #buildFsEntrySubdomains(rows: Array<{ uuid: string; subdomain: string }>): {
        subdomains: FSEntrySubdomain[];
        workers: FSEntrySubdomain[];
    } {
        const protocol = this.config.protocol ?? 'https';
        const siteDomain = this.config.static_hosting_domain ?? 'puter.site';
        const workerPrefix = 'workers.puter.';
        const workerDomain = 'puter.work';

        const subdomains: FSEntrySubdomain[] = [];
        const workers: FSEntrySubdomain[] = [];
        for (const row of rows) {
            if (row.subdomain.startsWith(workerPrefix)) {
                const workerName = row.subdomain.slice(workerPrefix.length);
                workers.push({
                    uuid: row.uuid,
                    subdomain: row.subdomain,
                    address: `${protocol}://${workerName}.${workerDomain}`,
                });
                continue;
            }
            subdomains.push({
                uuid: row.uuid,
                subdomain: row.subdomain,
                address: `${protocol}://${row.subdomain}.${siteDomain}`,
            });
        }
        return { subdomains, workers };
    }

    #normalizePath(path: string): string {
        const trimmed = path.trim();
        if (trimmed.length === 0) {
            throw new HttpError(400, 'Path cannot be empty');
        }

        let normalized = pathPosix.normalize(trimmed);
        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }
        if (normalized.length > 1 && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }

    #toBoolean(value: number | boolean | null | undefined): boolean {
        if (typeof value === 'boolean') {
            return value;
        }
        return Number(value ?? 0) === 1;
    }

    #toNullableBoolean(
        value: number | boolean | null | undefined,
    ): boolean | null {
        if (value === null || value === undefined) {
            return null;
        }
        return this.#toBoolean(value);
    }

    #mapFSEntryRow(row: FSEntryRow): FSEntry {
        const { subdomains, workers } = this.#buildFsEntrySubdomains(
            this.#parseSubdomainsAgg(row.subdomains_agg),
        );
        return {
            id: Number(row.id),
            uuid: row.uuid,
            uid: row.uuid,
            userId: Number(row.user_id),
            parentId: row.parent_id === null ? null : Number(row.parent_id),
            parentUid: row.parent_uid,
            path: row.path,
            name: row.name,
            isDir: this.#toBoolean(row.is_dir),
            bucket: row.bucket,
            bucketRegion: row.bucket_region,
            publicToken: row.public_token,
            fileRequestToken: row.file_request_token,
            isShortcut: this.#toBoolean(row.is_shortcut),
            shortcutTo: row.shortcut_to,
            associatedAppId: row.associated_app_id,
            layout: row.layout,
            sortBy: row.sort_by,
            sortOrder: row.sort_order,
            isPublic: this.#toNullableBoolean(row.is_public),
            thumbnail: row.thumbnail,
            immutable: this.#toBoolean(row.immutable),
            metadata: row.metadata,
            modified: Number(row.modified),
            created: row.created === null ? null : Number(row.created),
            accessed: row.accessed === null ? null : Number(row.accessed),
            size: row.size === null ? null : Number(row.size),
            symlinkPath: row.symlink_path,
            isSymlink: this.#toBoolean(row.is_symlink),
            subdomains,
            workers,
            hasWebsite: subdomains.length > 0,
            // Populated by `SuggestedAppsService` in the request path — kept
            // empty here so the field is always present on the type.
            suggestedApps: [],
        };
    }

    #entryCacheKeys(entry: FSEntry): string[] {
        return [
            `prodfsv2:fsentry:id:${entry.id}`,
            `prodfsv2:fsentry:uuid:${entry.uuid}`,
            `prodfsv2:fsentry:path:${entry.userId}:${entry.path}`,
            `prodfsv2:fsentry:path:any:${entry.path}`,
        ];
    }

    async #readEntryFromCache(cacheKey: string): Promise<FSEntry | null> {
        try {
            const cached = await this.clients.redis.get(cacheKey);
            if (!cached) {
                return null;
            }
            return JSON.parse(cached) as FSEntry;
        } catch {
            return null;
        }
    }

    async #writeEntryToCache(entry: FSEntry): Promise<void> {
        try {
            const serialized = JSON.stringify(entry);
            await Promise.all(
                this.#entryCacheKeys(entry).map((cacheKey) => {
                    return this.clients.redis.setex(
                        cacheKey,
                        ENTRY_CACHE_TTL_SECONDS,
                        serialized,
                    );
                }),
            );
        } catch {
            // Best effort cache write.
        }
    }

    async #invalidateEntryCache(entry: FSEntry): Promise<void> {
        // Broadcasts; read-path `#writeEntryToCache` stays local to avoid
        // fanning backfills over the network.
        const keys = this.#entryCacheKeys(entry);
        await this.publishCacheKeys({ keys });
    }

    async invalidateEntryCacheByPathForUser(
        userId: number,
        path: string,
    ): Promise<void> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKeys: string[] = [
            `prodfsv2:fsentry:path:${userId}:${normalizedPath}`,
            `prodfsv2:fsentry:path:any:${normalizedPath}`,
        ];

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE user_id = ? AND path = ? LIMIT 1`,
            [userId, normalizedPath],
        )) as unknown as FSEntryRow[];
        const row = rows[0];

        if (row) {
            const entry = this.#mapFSEntryRow(row);
            await this.#invalidateEntryCache(entry);
            return;
        }

        await this.publishCacheKeys({ keys: cacheKeys });
    }

    async invalidateEntryCacheByUuid(uuid: string): Promise<void> {
        if (typeof uuid !== 'string' || uuid.length === 0) {
            return;
        }

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE uuid = ? LIMIT 1`,
            [uuid],
        )) as unknown as FSEntryRow[];
        const row = rows[0];

        if (row) {
            const entry = this.#mapFSEntryRow(row);
            await this.#invalidateEntryCache(entry);
            return;
        }

        const cached = await this.#readEntryFromCache(
            `prodfsv2:fsentry:uuid:${uuid}`,
        );
        if (cached) {
            await this.#invalidateEntryCache(cached);
            return;
        }

        await this.publishCacheKeys({
            keys: [`prodfsv2:fsentry:uuid:${uuid}`],
        });
    }

    #chunk<T>(values: T[], size: number): T[][] {
        if (values.length === 0) {
            return [];
        }
        const chunks: T[][] = [];
        for (let index = 0; index < values.length; index += size) {
            chunks.push(values.slice(index, index + size));
        }
        return chunks;
    }

    async #writePendingUploadSessions(
        sessions: PendingUploadSession[],
        operationName: string,
    ): Promise<void> {
        if (sessions.length === 0) {
            return;
        }

        try {
            await this.stores.kv.batchPut({
                items: sessions.map((session) => ({
                    key: toPendingUploadSessionKey(session.sessionId),
                    value: session,
                    expireAt: toPendingUploadSessionExpiresAtSeconds(
                        session.expiresAt,
                    ),
                })),
            });
        } catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error(`Failed to ${operationName}`);
        }
    }

    async #getPendingUploadSessionsBySessionIds(
        sessionIds: string[],
    ): Promise<Map<string, PendingUploadSession>> {
        const uniqueSessionIds = Array.from(new Set(sessionIds));
        const sessionsById = new Map<string, PendingUploadSession>();
        if (uniqueSessionIds.length === 0) {
            return sessionsById;
        }

        const { res: rawValues } = await this.stores.kv.get({
            key: uniqueSessionIds.map((sessionId) =>
                toPendingUploadSessionKey(sessionId),
            ),
        });
        if (!Array.isArray(rawValues)) {
            return sessionsById;
        }

        for (let index = 0; index < uniqueSessionIds.length; index++) {
            const sessionId = uniqueSessionIds[index];
            const rawValue = rawValues[index];
            if (!sessionId) {
                continue;
            }

            const normalizedSession = normalizePendingUploadSession(
                rawValue,
                sessionId,
            );
            if (normalizedSession) {
                sessionsById.set(sessionId, normalizedSession);
            }
        }

        return sessionsById;
    }

    async #markPendingSessionsWithStatus(
        sessionIds: string[],
        status: PendingUploadSessionStatus,
        reason: string | null,
    ): Promise<void> {
        if (sessionIds.length === 0) {
            return;
        }

        const sessionsById =
            await this.#getPendingUploadSessionsBySessionIds(sessionIds);
        const now = Date.now();
        const updatedSessions = Array.from(new Set(sessionIds))
            .map((sessionId) => {
                const session = sessionsById.get(sessionId);
                if (!session) {
                    return null;
                }

                return withPendingUploadSessionStatus(
                    session,
                    status,
                    reason,
                    now,
                );
            })
            .filter((session): session is PendingUploadSession =>
                Boolean(session),
            );

        await this.#writePendingUploadSessions(
            updatedSessions,
            `mark pending upload sessions as ${status}`,
        );
    }

    async #readEntriesByPathsForUser(
        userId: number,
        paths: string[],
        options: ReadEntriesByPathsOptions = {},
    ): Promise<Map<string, FSEntry>> {
        const useTryHardRead = Boolean(options.useTryHardRead);
        const skipCache = Boolean(options.skipCache);
        const normalizedPaths = Array.from(
            new Set(
                paths
                    .map((path) => this.#normalizePath(path))
                    .filter((path) => path.length > 0),
            ),
        );
        const entriesByPath = new Map<string, FSEntry>();
        if (normalizedPaths.length === 0) {
            return entriesByPath;
        }

        const missingPaths: string[] = [];
        if (skipCache) {
            missingPaths.push(...normalizedPaths);
        } else {
            const cacheReads = await Promise.all(
                normalizedPaths.map(async (path) => {
                    const cacheKey = `prodfsv2:fsentry:path:${userId}:${path}`;
                    const cachedEntry =
                        await this.#readEntryFromCache(cacheKey);
                    return { path, cachedEntry };
                }),
            );

            for (const cacheRead of cacheReads) {
                if (cacheRead.cachedEntry) {
                    entriesByPath.set(cacheRead.path, cacheRead.cachedEntry);
                } else {
                    missingPaths.push(cacheRead.path);
                }
            }
        }

        const chunks = this.#chunk(missingPaths, BULK_QUERY_CHUNK_SIZE);
        const chunkResults = await runWithConcurrencyLimit(
            chunks,
            DEFAULT_DB_CHUNK_CONCURRENCY,
            async (chunk) => {
                if (chunk.length === 0) {
                    return [];
                }

                const placeholders = chunk.map(() => '?').join(', ');
                const selectSql = `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE user_id = ? AND path IN (${placeholders})`;
                const rows = (useTryHardRead
                    ? await this.clients.db.tryHardRead(selectSql, [
                          userId,
                          ...chunk,
                      ])
                    : await this.clients.db.read(selectSql, [
                          userId,
                          ...chunk,
                      ])) as unknown as FSEntryRow[];

                const entries = rows.map((row) => this.#mapFSEntryRow(row));
                if (entries.length > 0) {
                    await Promise.all(
                        entries.map((entry) => this.#writeEntryToCache(entry)),
                    );
                }
                return entries;
            },
        );
        for (const chunkEntries of chunkResults) {
            for (const entry of chunkEntries) {
                entriesByPath.set(entry.path, entry);
            }
        }

        return entriesByPath;
    }

    #pathDepth(path: string): number {
        return path.split('/').filter(Boolean).length;
    }

    async #ensureDirectoryPathsForUser(
        userId: number,
        requiredPaths: string[],
    ): Promise<{
        requiredEntryMap: Map<string, FSEntry>;
        createdEntryMap: Map<string, FSEntry>;
    }> {
        const normalizedRequiredPaths = Array.from(
            new Set(
                requiredPaths
                    .map((path) => this.#normalizePath(path))
                    .filter((path) => path !== '/'),
            ),
        );
        const requiredEntryMap = new Map<string, FSEntry>();
        const createdEntryMap = new Map<string, FSEntry>();
        if (normalizedRequiredPaths.length === 0) {
            return {
                requiredEntryMap,
                createdEntryMap,
            };
        }

        const candidateDirSet = new Set<string>();
        for (const requiredPath of normalizedRequiredPaths) {
            let cursor = requiredPath;
            while (cursor !== '/') {
                candidateDirSet.add(cursor);
                cursor = pathPosix.dirname(cursor);
            }
        }

        const candidatePaths = Array.from(candidateDirSet);
        const allEntries = await this.#readEntriesByPathsForUser(
            userId,
            candidatePaths,
        );
        for (const path of candidatePaths) {
            const entry = allEntries.get(path);
            if (entry && !entry.isDir) {
                throw new HttpError(409, `Path is not a directory: ${path}`);
            }
        }

        const missingPaths = candidatePaths
            .filter((path) => !allEntries.has(path))
            .sort(
                (pathA, pathB) =>
                    this.#pathDepth(pathA) - this.#pathDepth(pathB),
            );
        if (missingPaths.length > 0) {
            const uniqueDepths = Array.from(
                new Set(missingPaths.map((path) => this.#pathDepth(path))),
            ).sort((depthA, depthB) => depthA - depthB);

            for (const depth of uniqueDepths) {
                const pathsAtDepth = missingPaths.filter(
                    (path) => this.#pathDepth(path) === depth,
                );
                if (pathsAtDepth.length === 0) {
                    continue;
                }

                const now = Math.floor(Date.now() / 1000);
                const insertRows: unknown[] = [];
                const valuePlaceholders: string[] = [];
                const expectedUuidByPath = new Map<string, string>();
                for (const dirPath of pathsAtDepth) {
                    const parentPath = pathPosix.dirname(dirPath);
                    const parentEntry =
                        parentPath === '/' ? null : allEntries.get(parentPath);
                    if (parentPath !== '/' && !parentEntry) {
                        throw new Error(
                            `Parent directory not resolved while creating ${dirPath}`,
                        );
                    }
                    if (parentEntry && !parentEntry.isDir) {
                        throw new HttpError(
                            409,
                            `Path is not a directory: ${parentPath}`,
                        );
                    }

                    const expectedUuid = uuidv4();
                    expectedUuidByPath.set(dirPath, expectedUuid);
                    valuePlaceholders.push(
                        '(?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0)',
                    );
                    insertRows.push(
                        expectedUuid,
                        userId,
                        parentEntry ? parentEntry.id : null,
                        parentEntry ? parentEntry.uuid : null,
                        pathPosix.basename(dirPath),
                        dirPath,
                        now,
                        now,
                        now,
                    );
                }

                try {
                    await this.clients.db.write(
                        `${this.#insertIgnoreIntoFsentriesSql()} (
                            uuid,
                            user_id,
                            parent_id,
                            parent_uid,
                            name,
                            path,
                            is_dir,
                            created,
                            modified,
                            accessed,
                            immutable,
                            size
                        ) VALUES ${valuePlaceholders.join(', ')}`,
                        insertRows,
                    );
                } catch {
                    // Concurrent create may have already inserted some/all rows.
                }

                const insertedEntries = await this.#readEntriesByPathsForUser(
                    userId,
                    pathsAtDepth,
                    { useTryHardRead: true },
                );
                for (const path of pathsAtDepth) {
                    let insertedEntry = insertedEntries.get(path);
                    if (!insertedEntry) {
                        insertedEntry = await this.#ensureDirectoryPath(
                            path,
                            userId,
                            true,
                        );
                    }
                    if (!insertedEntry.isDir) {
                        throw new HttpError(
                            409,
                            `Path is not a directory: ${path}`,
                        );
                    }
                    if (expectedUuidByPath.get(path) === insertedEntry.uuid) {
                        createdEntryMap.set(path, insertedEntry);
                    }
                    allEntries.set(path, insertedEntry);
                }
            }
        }

        for (const requiredPath of normalizedRequiredPaths) {
            const entry = allEntries.get(requiredPath);
            if (!entry) {
                throw new Error(
                    `Failed to resolve directory path: ${requiredPath}`,
                );
            }
            if (!entry.isDir) {
                throw new HttpError(
                    409,
                    `Path is not a directory: ${requiredPath}`,
                );
            }
            requiredEntryMap.set(requiredPath, entry);
        }

        return {
            requiredEntryMap,
            createdEntryMap,
        };
    }

    async #getEntryByPathAndUser(
        path: string,
        userId: number,
    ): Promise<FSEntry | null> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKey = `prodfsv2:fsentry:path:${userId}:${normalizedPath}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE path = ? AND user_id = ? LIMIT 1`,
            [normalizedPath, userId],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async #ensureDirectoryPath(
        path: string,
        userId: number,
        createPaths: boolean,
    ): Promise<FSEntry> {
        const normalizedPath = this.#normalizePath(path);

        const existingEntry = await this.#getEntryByPathAndUser(
            normalizedPath,
            userId,
        );
        if (existingEntry) {
            if (!existingEntry.isDir) {
                throw new HttpError(
                    409,
                    `Path is not a directory: ${normalizedPath}`,
                );
            }
            return existingEntry;
        }

        if (!createPaths) {
            throw new HttpError(
                404,
                `Parent path does not exist: ${normalizedPath}`,
            );
        }

        if (normalizedPath === '/') {
            throw new HttpError(400, 'Cannot create root directory');
        }

        const parentPath = pathPosix.dirname(normalizedPath);
        const parentEntry =
            parentPath === '/'
                ? null
                : await this.#ensureDirectoryPath(parentPath, userId, true);
        const dirName = pathPosix.basename(normalizedPath);
        const now = Math.floor(Date.now() / 1000);

        try {
            await this.clients.db.write(
                `${this.#insertIgnoreIntoFsentriesSql()} (
                    uuid,
                    user_id,
                    parent_id,
                    parent_uid,
                    name,
                    path,
                    is_dir,
                    created,
                    modified,
                    accessed,
                    immutable,
                    size
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0)`,
                [
                    uuidv4(),
                    userId,
                    parentEntry ? parentEntry.id : null,
                    parentEntry ? parentEntry.uuid : null,
                    dirName,
                    normalizedPath,
                    now,
                    now,
                    now,
                ],
            );
        } catch {
            // If another request created it first, we'll fetch it below.
        }

        const resolvedEntries = await this.#readEntriesByPathsForUser(
            userId,
            [normalizedPath],
            { useTryHardRead: true },
        );
        const resolvedEntry = resolvedEntries.get(normalizedPath) ?? null;
        if (!resolvedEntry) {
            throw new Error(
                `Failed to resolve directory path: ${normalizedPath}`,
            );
        }
        if (!resolvedEntry.isDir) {
            throw new HttpError(
                409,
                `Path is not a directory: ${normalizedPath}`,
            );
        }

        return resolvedEntry;
    }

    #serializeMetadata(input: FSEntryCreateInput): string | null {
        if (typeof input.metadata === 'string') {
            return input.metadata;
        }

        const metadataObject: Record<string, unknown> =
            input.metadata && typeof input.metadata === 'object'
                ? { ...input.metadata }
                : {};

        if (input.contentType) {
            metadataObject.contentType = input.contentType;
        }
        if (input.checksumSha256) {
            metadataObject.checksumSha256 = input.checksumSha256;
        }

        if (Object.keys(metadataObject).length === 0) {
            return null;
        }

        return JSON.stringify(metadataObject);
    }

    async getEntryByPath(path: string): Promise<FSEntry | null> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKey = `prodfsv2:fsentry:path:any:${normalizedPath}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE path = ? LIMIT 1`,
            [normalizedPath],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async getEntriesByPaths(paths: string[]): Promise<Map<string, FSEntry>> {
        const normalizedPaths = Array.from(
            new Set(
                paths
                    .map((path) => this.#normalizePath(path))
                    .filter((path) => path.length > 0),
            ),
        );
        const entriesByPath = new Map<string, FSEntry>();
        if (normalizedPaths.length === 0) {
            return entriesByPath;
        }

        const missingPaths: string[] = [];
        const cacheReads = await Promise.all(
            normalizedPaths.map(async (path) => {
                const cacheKey = `prodfsv2:fsentry:path:any:${path}`;
                const cachedEntry = await this.#readEntryFromCache(cacheKey);
                return { path, cachedEntry };
            }),
        );
        for (const { path, cachedEntry } of cacheReads) {
            if (cachedEntry) {
                entriesByPath.set(path, cachedEntry);
            } else {
                missingPaths.push(path);
            }
        }

        if (missingPaths.length > 0) {
            const chunks = this.#chunk(missingPaths, BULK_QUERY_CHUNK_SIZE);
            const chunkResults = await runWithConcurrencyLimit(
                chunks,
                DEFAULT_DB_CHUNK_CONCURRENCY,
                async (chunk) => {
                    if (chunk.length === 0) {
                        return [];
                    }
                    const placeholders = chunk.map(() => '?').join(', ');
                    const rows = (await this.clients.db.read(
                        `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE path IN (${placeholders})`,
                        chunk,
                    )) as unknown as FSEntryRow[];
                    const entries = rows.map((row) => this.#mapFSEntryRow(row));
                    await Promise.all(
                        entries.map((entry) => this.#writeEntryToCache(entry)),
                    );
                    return entries;
                },
            );
            for (const chunkEntries of chunkResults) {
                for (const entry of chunkEntries) {
                    entriesByPath.set(entry.path, entry);
                }
            }
        }

        return entriesByPath;
    }

    async getEntryByUuid(id: string): Promise<FSEntry | null> {
        const cacheKey = `prodfsv2:fsentry:uuid:${id}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE uuid = ? LIMIT 1`,
            [id],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async getEntryById(id: number): Promise<FSEntry | null> {
        const cacheKey = `prodfsv2:fsentry:id:${id}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if (cached) {
            return cached;
        }

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE id = ? LIMIT 1`,
            [id],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async updateEntryThumbnailByUuidForUser(
        userId: number,
        uuid: string,
        thumbnail: string | null,
    ): Promise<FSEntry> {
        const now = Math.floor(Date.now() / 1000);
        const writeResult = await this.clients.db.write(
            `UPDATE fsentries
             SET thumbnail = ?,
                 modified = ?,
                 accessed = ?
             WHERE uuid = ? AND user_id = ?`,
            [thumbnail, now, now, uuid, userId],
        );
        if (typeof writeResult === 'object' && writeResult !== null) {
            const writeResultRecord = writeResult as unknown as Record<
                string,
                unknown
            >;
            const anyRowsAffected = writeResultRecord.anyRowsAffected;
            if (typeof anyRowsAffected === 'boolean' && !anyRowsAffected) {
                throw new HttpError(
                    404,
                    'File entry was not found for thumbnail update',
                );
            }

            const affectedRowsRaw = writeResultRecord.affectedRows;
            const affectedRows = Number(affectedRowsRaw);
            if (
                affectedRowsRaw !== undefined &&
                Number.isFinite(affectedRows) &&
                affectedRows <= 0
            ) {
                throw new HttpError(
                    404,
                    'File entry was not found for thumbnail update',
                );
            }
        }

        const refreshedRows = (await this.clients.db.tryHardRead(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE uuid = ? AND user_id = ? LIMIT 1`,
            [uuid, userId],
        )) as unknown as FSEntryRow[];
        const refreshedRow = refreshedRows[0];
        if (!refreshedRow) {
            throw new HttpError(
                404,
                'File entry was not found for thumbnail update',
            );
        }

        const updatedEntry = this.#mapFSEntryRow(refreshedRow);
        await this.#invalidateEntryCache(updatedEntry);
        await this.#writeEntryToCache(updatedEntry);
        return updatedEntry;
    }

    async resolveParentDirectory(
        userId: number,
        parentPath: string,
        createPaths: boolean,
    ): Promise<FSEntry> {
        return this.#ensureDirectoryPath(parentPath, userId, createPaths);
    }

    async getEntryByPathForUser(
        path: string,
        userId: number,
        options: ReadEntriesByPathsOptions = {},
    ): Promise<FSEntry | null> {
        if (path === '~' || path.startsWith('~/')) {
            const username = (await this.stores.user.getById(userId))?.username;
            if (!username) {
                throw new HttpError(400, 'Unable to resolve home path');
            }

            path = `/${username}${path.slice(1)}`;
        }

        if (!options.useTryHardRead && !options.skipCache) {
            return this.#getEntryByPathAndUser(path, userId);
        }

        const normalizedPath = this.#normalizePath(path);
        const entriesByPath = await this.#readEntriesByPathsForUser(
            userId,
            [normalizedPath],
            options,
        );
        return entriesByPath.get(normalizedPath) ?? null;
    }

    async getEntriesByPathsForUser(
        userId: number,
        paths: string[],
        options: ReadEntriesByPathsOptions = {},
    ): Promise<(FSEntry | null)[]> {
        const entriesByPath = await this.#readEntriesByPathsForUser(
            userId,
            paths,
            options,
        );
        return paths.map((path) => {
            const normalizedPath = this.#normalizePath(path);
            return entriesByPath.get(normalizedPath) ?? null;
        });
    }

    async resolveParentDirectoriesBatch(
        userId: number,
        requests: { parentPath: string; createPaths: boolean }[],
    ): Promise<FSEntry[]> {
        const { parentEntries } =
            await this.resolveParentDirectoriesBatchWithCreated(
                userId,
                requests,
            );
        return parentEntries;
    }

    async resolveParentDirectoriesBatchWithCreated(
        userId: number,
        requests: { parentPath: string; createPaths: boolean }[],
    ): Promise<{
        parentEntries: FSEntry[];
        createdDirectoryEntries: FSEntry[];
    }> {
        if (requests.length === 0) {
            return {
                parentEntries: [],
                createdDirectoryEntries: [],
            };
        }

        const parentPathsToEnsure = requests
            .filter((request) => request.createPaths)
            .map((request) => request.parentPath);
        const { createdEntryMap } = await this.#ensureDirectoryPathsForUser(
            userId,
            parentPathsToEnsure,
        );

        const allParentPaths = requests.map((request) => request.parentPath);
        const parentEntriesByPath = await this.#readEntriesByPathsForUser(
            userId,
            allParentPaths,
        );
        const parentEntries = allParentPaths.map((path) => {
            const normalizedPath = this.#normalizePath(path);
            const parentEntry = parentEntriesByPath.get(normalizedPath);
            if (!parentEntry) {
                throw new HttpError(
                    404,
                    `Parent path does not exist: ${normalizedPath}`,
                );
            }
            if (!parentEntry.isDir) {
                throw new HttpError(
                    409,
                    `Path is not a directory: ${normalizedPath}`,
                );
            }
            return parentEntry;
        });

        return {
            parentEntries,
            createdDirectoryEntries: Array.from(createdEntryMap.values()),
        };
    }

    async ensureDirectoriesForUser(
        userId: number,
        requests: { path: string; createPaths: boolean }[],
    ): Promise<FSEntry[]> {
        const { entries } = await this.ensureDirectoriesForUserWithCreated(
            userId,
            requests,
        );
        return entries;
    }

    async ensureDirectoriesForUserWithCreated(
        userId: number,
        requests: { path: string; createPaths: boolean }[],
    ): Promise<{
        entries: FSEntry[];
        createdDirectoryEntries: FSEntry[];
    }> {
        if (requests.length === 0) {
            return {
                entries: [],
                createdDirectoryEntries: [],
            };
        }

        const normalizedRequests = requests.map((request) => {
            const normalizedPath = this.#normalizePath(request.path);
            if (normalizedPath === '/') {
                throw new HttpError(400, 'Cannot create root directory');
            }
            return {
                path: normalizedPath,
                createPaths: request.createPaths,
            };
        });

        const pathsToEnsure = normalizedRequests
            .filter((request) => request.createPaths)
            .map((request) => request.path);
        const { createdEntryMap } = await this.#ensureDirectoryPathsForUser(
            userId,
            pathsToEnsure,
        );

        const allPaths = normalizedRequests.map((request) => request.path);
        const entriesByPath = await this.#readEntriesByPathsForUser(
            userId,
            allPaths,
        );

        const entries = normalizedRequests.map((request) => {
            const entry = entriesByPath.get(request.path);
            if (!entry) {
                throw new HttpError(
                    404,
                    `Directory path does not exist: ${request.path}`,
                );
            }
            if (!entry.isDir) {
                throw new HttpError(
                    409,
                    `Path is not a directory: ${request.path}`,
                );
            }
            return entry;
        });

        return {
            entries,
            createdDirectoryEntries: Array.from(createdEntryMap.values()),
        };
    }

    async createEntry(
        fsEntry: FSEntryCreateInput,
        createPaths = true,
    ): Promise<FSEntry> {
        const [entry] = await this.batchCreateEntries([fsEntry], createPaths);
        if (!entry) {
            throw new Error('Failed to create entry');
        }
        return entry;
    }

    async batchCreateEntries(
        entries: FSEntryCreateInput[],
        createPaths = true,
    ): Promise<FSEntry[]> {
        if (entries.length === 0) {
            return [];
        }

        const normalizedEntries: NormalizedEntryWrite[] = entries.map(
            (entryInput, index) => {
                const targetPath = this.#normalizePath(entryInput.path);
                if (targetPath === '/') {
                    throw new HttpError(400, 'Cannot write to root path');
                }

                const parentPath = this.#normalizePath(
                    pathPosix.dirname(targetPath),
                );
                if (parentPath === '/') {
                    throw new HttpError(
                        400,
                        'Cannot write directly under root path',
                    );
                }

                const size = Number(entryInput.size);
                if (Number.isNaN(size) || size < 0) {
                    throw new HttpError(
                        400,
                        `Invalid size for path ${targetPath}`,
                    );
                }

                return {
                    index,
                    input: entryInput,
                    userId: entryInput.userId,
                    targetPath,
                    parentPath,
                    fileName: pathPosix.basename(targetPath),
                    metadataJson: this.#serializeMetadata(entryInput),
                    bucket: entryInput.bucket ?? null,
                    bucketRegion: entryInput.bucketRegion ?? null,
                    size,
                    createPaths: entryInput.createMissingParents ?? createPaths,
                };
            },
        );

        const duplicatePathSet = new Set<string>();
        for (const normalizedEntry of normalizedEntries) {
            const dedupeKey = `${normalizedEntry.userId}:${normalizedEntry.targetPath}`;
            if (duplicatePathSet.has(dedupeKey)) {
                throw new HttpError(
                    409,
                    `Batch contains duplicate target path: ${normalizedEntry.targetPath}`,
                );
            }
            duplicatePathSet.add(dedupeKey);
        }

        const entriesByUser = new Map<number, NormalizedEntryWrite[]>();
        for (const normalizedEntry of normalizedEntries) {
            const userEntries = entriesByUser.get(normalizedEntry.userId) ?? [];
            userEntries.push(normalizedEntry);
            entriesByUser.set(normalizedEntry.userId, userEntries);
        }

        const resultsByIndex = new Map<number, FSEntry>();
        for (const [userId, userEntries] of entriesByUser) {
            const parentEntries = await this.resolveParentDirectoriesBatch(
                userId,
                userEntries.map((entry) => ({
                    parentPath: entry.parentPath,
                    createPaths: entry.createPaths,
                })),
            );
            const parentByPath = new Map<string, FSEntry>();
            for (const parentEntry of parentEntries) {
                parentByPath.set(parentEntry.path, parentEntry);
            }

            const existingEntriesByPath = await this.#readEntriesByPathsForUser(
                userId,
                userEntries.map((entry) => entry.targetPath),
                {
                    useTryHardRead: true,
                    skipCache: true,
                },
            );

            const now = Math.floor(Date.now() / 1000);
            const updateOperations: Array<{
                existingEntry: FSEntry;
                updatedEntry: FSEntry;
                promise: Promise<unknown>;
            }> = [];
            const updatedResultsByIndex = new Map<number, FSEntry>();
            const insertCandidates: NormalizedEntryWrite[] = [];

            for (const entry of userEntries) {
                const parentEntry = parentByPath.get(entry.parentPath);
                if (!parentEntry) {
                    throw new Error(
                        `Failed to resolve parent directory for ${entry.targetPath}`,
                    );
                }

                const existingEntry = existingEntriesByPath.get(
                    entry.targetPath,
                );
                if (existingEntry) {
                    if (!entry.input.overwrite) {
                        throw new HttpError(
                            409,
                            `Entry already exists at ${entry.targetPath}`,
                        );
                    }
                    if (existingEntry.isDir) {
                        throw new HttpError(
                            409,
                            `Cannot overwrite a directory at ${entry.targetPath}`,
                        );
                    }

                    const updatedEntry = {
                        ...existingEntry,
                        bucket: entry.bucket,
                        bucketRegion: entry.bucketRegion,
                        parentId: parentEntry.id,
                        parentUid: parentEntry.uuid,
                        associatedAppId: entry.input.associatedAppId ?? null,
                        isPublic:
                            entry.input.isPublic === undefined
                                ? null
                                : Boolean(entry.input.isPublic),
                        thumbnail: entry.input.thumbnail ?? null,
                        immutable: Boolean(entry.input.immutable),
                        name: entry.fileName,
                        path: entry.targetPath,
                        metadata: entry.metadataJson,
                        modified: now,
                        accessed: now,
                        size: entry.size,
                    };
                    updateOperations.push({
                        existingEntry,
                        updatedEntry,
                        promise: this.clients.db.write(
                            `UPDATE fsentries
                             SET bucket = ?,
                                 bucket_region = ?,
                                 parent_id = ?,
                                 parent_uid = ?,
                                 associated_app_id = ?,
                                 is_public = ?,
                                 thumbnail = ?,
                                 immutable = ?,
                                 name = ?,
                                 path = ?,
                                 metadata = ?,
                                 modified = ?,
                                 accessed = ?,
                                 size = ?
                             WHERE id = ?`,
                            [
                                entry.bucket,
                                entry.bucketRegion,
                                parentEntry.id,
                                parentEntry.uuid,
                                entry.input.associatedAppId ?? null,
                                entry.input.isPublic === undefined
                                    ? null
                                    : entry.input.isPublic
                                      ? 1
                                      : 0,
                                entry.input.thumbnail ?? null,
                                entry.input.immutable ? 1 : 0,
                                entry.fileName,
                                entry.targetPath,
                                entry.metadataJson,
                                now,
                                now,
                                entry.size,
                                existingEntry.id,
                            ],
                        ),
                    });
                    updatedResultsByIndex.set(entry.index, updatedEntry);
                    continue;
                }

                insertCandidates.push(entry);
            }

            if (updateOperations.length > 0) {
                const updateResults = await Promise.allSettled(
                    updateOperations.map((operation) => operation.promise),
                );
                const successfulUpdateOperations = updateResults.flatMap(
                    (result, index) => {
                        if (result.status !== 'fulfilled') {
                            return [];
                        }
                        const operation = updateOperations[index];
                        return operation ? [operation] : [];
                    },
                );
                if (successfulUpdateOperations.length > 0) {
                    await Promise.all(
                        successfulUpdateOperations.map((operation) => {
                            return this.#invalidateEntryCache(
                                operation.existingEntry,
                            );
                        }),
                    );
                    await Promise.all(
                        successfulUpdateOperations.map((operation) => {
                            return this.#writeEntryToCache(
                                operation.updatedEntry,
                            );
                        }),
                    );
                }

                const failedUpdate = updateResults.find(
                    (result) => result.status === 'rejected',
                );
                if (failedUpdate?.status === 'rejected') {
                    throw failedUpdate.reason instanceof Error
                        ? failedUpdate.reason
                        : new Error('Failed to update fsentries batch');
                }
            }

            const insertChunks = this.#chunk(
                insertCandidates,
                BULK_QUERY_CHUNK_SIZE,
            );
            await runWithConcurrencyLimit(
                insertChunks,
                DEFAULT_DB_CHUNK_CONCURRENCY,
                async (insertChunk) => {
                    if (insertChunk.length === 0) {
                        return;
                    }

                    const valuePlaceholders: string[] = [];
                    const values: unknown[] = [];
                    for (const entry of insertChunk) {
                        const parentEntry = parentByPath.get(entry.parentPath);
                        if (!parentEntry) {
                            throw new Error(
                                `Failed to resolve parent directory for ${entry.targetPath}`,
                            );
                        }

                        valuePlaceholders.push(
                            '(?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        );
                        values.push(
                            entry.input.uuid,
                            entry.bucket,
                            entry.bucketRegion,
                            userId,
                            parentEntry.id,
                            parentEntry.uuid,
                            entry.input.associatedAppId ?? null,
                            entry.input.isPublic === undefined
                                ? null
                                : entry.input.isPublic
                                  ? 1
                                  : 0,
                            entry.input.thumbnail ?? null,
                            entry.input.immutable ? 1 : 0,
                            entry.fileName,
                            entry.targetPath,
                            entry.metadataJson,
                            now,
                            now,
                            now,
                            entry.size,
                        );
                    }

                    await this.clients.db.write(
                        `INSERT INTO fsentries (
                            uuid,
                            bucket,
                            bucket_region,
                            user_id,
                            parent_id,
                            parent_uid,
                            associated_app_id,
                            is_dir,
                            is_public,
                            thumbnail,
                            immutable,
                            name,
                            path,
                            metadata,
                            modified,
                            created,
                            accessed,
                            size
                        ) VALUES ${valuePlaceholders.join(', ')}`,
                        values,
                    );
                },
            );

            const insertedEntriesByUuid = new Map<string, FSEntry>();
            if (insertCandidates.length > 0) {
                const insertUuidChunks = this.#chunk(
                    insertCandidates.map((entry) => entry.input.uuid),
                    BULK_QUERY_CHUNK_SIZE,
                );

                const insertedChunkResults = await runWithConcurrencyLimit(
                    insertUuidChunks,
                    DEFAULT_DB_CHUNK_CONCURRENCY,
                    async (insertUuidChunk) => {
                        if (insertUuidChunk.length === 0) {
                            return [];
                        }

                        const placeholders = insertUuidChunk
                            .map(() => '?')
                            .join(', ');
                        const rows = (await this.clients.db.tryHardRead(
                            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE user_id = ? AND uuid IN (${placeholders})`,
                            [userId, ...insertUuidChunk],
                        )) as unknown as FSEntryRow[];

                        const insertedEntries = rows.map((row) =>
                            this.#mapFSEntryRow(row),
                        );
                        if (insertedEntries.length > 0) {
                            await Promise.all(
                                insertedEntries.map((entry) =>
                                    this.#writeEntryToCache(entry),
                                ),
                            );
                        }
                        return insertedEntries;
                    },
                );
                for (const insertedEntries of insertedChunkResults) {
                    for (const insertedEntry of insertedEntries) {
                        insertedEntriesByUuid.set(
                            insertedEntry.uuid,
                            insertedEntry,
                        );
                    }
                }
            }

            for (const entry of userEntries) {
                const updatedResult = updatedResultsByIndex.get(entry.index);
                if (updatedResult) {
                    resultsByIndex.set(entry.index, updatedResult);
                    continue;
                }

                const insertedResult = insertedEntriesByUuid.get(
                    entry.input.uuid,
                );
                if (insertedResult) {
                    resultsByIndex.set(entry.index, insertedResult);
                    continue;
                }

                throw new Error(
                    `Failed to load final entry for ${entry.targetPath}`,
                );
            }
        }

        const createdEntries: FSEntry[] = [];
        for (let index = 0; index < entries.length; index++) {
            const entry = resultsByIndex.get(index);
            if (!entry) {
                throw new Error(
                    `Failed to resolve entry result at index ${index}`,
                );
            }
            createdEntries.push(entry);
        }
        return createdEntries;
    }

    async createPendingEntry(
        entry: PendingUploadCreateInput,
    ): Promise<PendingUploadSession> {
        const [createdEntry] = await this.batchCreatePendingEntries([entry]);
        if (!createdEntry) {
            throw new Error('Failed to create pending upload entry');
        }
        return createdEntry;
    }

    async batchCreatePendingEntries(
        entries: PendingUploadCreateInput[],
    ): Promise<PendingUploadSession[]> {
        if (entries.length === 0) {
            return [];
        }
        const now = Date.now();
        const pendingSessions = entries.map((entry) =>
            toPendingUploadSession(entry, now),
        );
        await this.#writePendingUploadSessions(
            pendingSessions,
            'create pending upload sessions',
        );
        return pendingSessions;
    }

    async getPendingEntryBySessionId(
        sessionId: string,
    ): Promise<PendingUploadSession | null> {
        // SystemKVStore returns `{ res, usage }`. Hand the raw value (res)
        // to the normalizer — passing the envelope would trip
        // `isPendingUploadSession` and silently 404 the session.
        const { res } = await this.stores.kv.get({
            key: toPendingUploadSessionKey(sessionId),
        });
        return normalizePendingUploadSession(res, sessionId);
    }

    async getPendingEntriesBySessionIds(
        sessionIds: string[],
    ): Promise<(PendingUploadSession | null)[]> {
        if (sessionIds.length === 0) {
            return [];
        }

        const entriesBySessionId =
            await this.#getPendingUploadSessionsBySessionIds(sessionIds);
        return sessionIds.map(
            (sessionId) => entriesBySessionId.get(sessionId) ?? null,
        );
    }

    async markPendingEntryCompleted(sessionId: string): Promise<void> {
        await this.#markPendingSessionsWithStatus(
            [sessionId],
            'completed',
            null,
        );
    }

    async markPendingEntryFailed(
        sessionId: string,
        reason: string,
    ): Promise<void> {
        await this.#markPendingSessionsWithStatus(
            [sessionId],
            'failed',
            reason,
        );
    }

    async markPendingEntriesFailed(
        sessionIds: string[],
        reason: string,
    ): Promise<void> {
        await this.#markPendingSessionsWithStatus(sessionIds, 'failed', reason);
    }

    async abortPendingEntry(sessionId: string, reason: string): Promise<void> {
        await this.#markPendingSessionsWithStatus(
            [sessionId],
            'aborted',
            reason,
        );
    }

    async completePendingEntry(
        sessionId: string,
        finalData: FSEntryCreateInput,
    ): Promise<FSEntry> {
        const [completedEntry] = await this.batchCompletePendingEntries([
            { sessionId, finalData },
        ]);
        if (!completedEntry) {
            throw new Error('Failed to complete pending entry');
        }
        return completedEntry;
    }

    async batchCompletePendingEntries(
        entries: { sessionId: string; finalData: FSEntryCreateInput }[],
    ): Promise<FSEntry[]> {
        if (entries.length === 0) {
            return [];
        }

        const completedEntries = await this.batchCreateEntries(
            entries.map((entry) => entry.finalData),
            true,
        );

        await this.#markPendingSessionsWithStatus(
            entries.map((entry) => entry.sessionId),
            'completed',
            null,
        );

        return completedEntries;
    }

    // ── Non-file entry creation (dirs, shortcuts, symlinks, touch) ──────

    /**
     * Create a single non-file entry: directory, shortcut, or symlink.
     *
     * Unlike `batchCreateEntries` (which is geared to S3-backed files),
     * these rows carry no bucket metadata. The caller is responsible for
     * parent/name conflict resolution — this method assumes the parent
     * exists and the target name is free.
     *
     * Returns the inserted entry with a refreshed row read. Throws 409 on
     * a unique-key collision (caller should pre-check and dedupe).
     */
    async createNonFileEntry(input: {
        userId: number;
        parent: FSEntry;
        name: string;
        kind: 'directory' | 'shortcut' | 'symlink' | 'empty-file';
        shortcutTo?: number | null;
        symlinkPath?: string | null;
        associatedAppId?: number | null;
        metadata?: string | null;
        immutable?: boolean;
        isPublic?: boolean | null;
        thumbnail?: string | null;
    }): Promise<FSEntry> {
        const uuid = uuidv4();
        const now = Math.floor(Date.now() / 1000);
        const parentPath = this.#normalizePath(input.parent.path);
        const path =
            parentPath === '/'
                ? `/${input.name}`
                : `${parentPath}/${input.name}`;

        const isDir = input.kind === 'directory' ? 1 : 0;
        const isShortcut = input.kind === 'shortcut' ? 1 : 0;
        const isSymlink = input.kind === 'symlink' ? 1 : 0;

        await this.clients.db.write(
            `INSERT INTO fsentries (
                uuid,
                user_id,
                parent_id,
                parent_uid,
                name,
                path,
                is_dir,
                is_shortcut,
                shortcut_to,
                is_symlink,
                symlink_path,
                associated_app_id,
                metadata,
                thumbnail,
                immutable,
                is_public,
                created,
                modified,
                accessed,
                size
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                uuid,
                input.userId,
                input.parent.id,
                input.parent.uuid,
                input.name,
                path,
                isDir,
                isShortcut,
                input.shortcutTo ?? null,
                isSymlink,
                input.symlinkPath ?? null,
                input.associatedAppId ?? null,
                input.metadata ?? null,
                input.thumbnail ?? null,
                input.immutable ? 1 : 0,
                input.isPublic === undefined || input.isPublic === null
                    ? null
                    : input.isPublic
                      ? 1
                      : 0,
                now,
                now,
                now,
                0,
            ],
        );

        const rows = (await this.clients.db.tryHardRead(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE uuid = ? LIMIT 1`,
            [uuid],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) {
            throw new HttpError(500, 'Failed to read created entry');
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    /**
     * Update accessed/modified/created timestamps in place. Used by `touch`
     * for entries that already exist.
     */
    async touchEntryTimestamps(
        uuid: string,
        options: {
            setAccessed?: boolean;
            setModified?: boolean;
            setCreated?: boolean;
        },
    ): Promise<FSEntry> {
        const now = Math.floor(Date.now() / 1000);
        const assignments: string[] = [];
        const values: unknown[] = [];
        if (options.setAccessed) {
            assignments.push('accessed = ?');
            values.push(now);
        }
        if (options.setModified) {
            assignments.push('modified = ?');
            values.push(now);
        }
        if (options.setCreated) {
            assignments.push('created = ?');
            values.push(now);
        }
        if (assignments.length === 0) {
            // Default: touch all three.
            assignments.push('accessed = ?', 'modified = ?', 'created = ?');
            values.push(now, now, now);
        }
        await this.clients.db.write(
            `UPDATE fsentries SET ${assignments.join(', ')} WHERE uuid = ?`,
            [...values, uuid],
        );
        const entry = await this.getEntryByUuid(uuid);
        if (!entry) throw new HttpError(404, 'Entry not found after touch');
        await this.#invalidateEntryCache(entry);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    // ── Listing / descendants / search ──────────────────────────────────

    // Children of a directory (direct children only). Paginated + sortable.
    async listChildren(
        parentUid: string,
        options: {
            limit?: number;
            offset?: number;
            sortBy?: 'name' | 'modified' | 'type' | 'size' | null;
            sortOrder?: 'asc' | 'desc' | null;
        } = {},
    ): Promise<FSEntry[]> {
        const limit = Number.isFinite(options.limit)
            ? Math.max(1, Math.min(10_000, Number(options.limit)))
            : 10_000;
        const offset = Number.isFinite(options.offset)
            ? Math.max(0, Number(options.offset))
            : 0;

        // Map sort field to a safe column name; reject anything else.
        const sortColumn = (() => {
            switch (options.sortBy) {
                case 'modified':
                    return 'modified';
                case 'size':
                    return 'size';
                case 'type':
                    return 'is_dir'; // directories first when DESC
                case 'name':
                default:
                    return 'name';
            }
        })();
        const sortDirection = options.sortOrder === 'desc' ? 'DESC' : 'ASC';

        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()}
             FROM fsentries
             WHERE parent_uid = ?
             ORDER BY ${sortColumn} ${sortDirection}
             LIMIT ${limit} OFFSET ${offset}`,
            [parentUid],
        )) as unknown as FSEntryRow[];
        const entries = rows.map((row) => this.#mapFSEntryRow(row));
        await Promise.all(
            entries.map((entry) => this.#writeEntryToCache(entry)),
        );
        return entries;
    }

    // Escape a string for safe use inside a LIKE pattern. We use backslash as
    // the LIKE escape char so `%` and `_` in user paths aren't treated as wildcards.
    // Uses `!` as the LIKE escape character — both MySQL and SQLite treat `!` as
    // a plain character inside string literals, so no dialect-specific quoting.
    #escapeLikePattern(value: string): string {
        return value.replace(/([!%_])/g, '!$1');
    }

    // All descendants of a directory path (recursive). Paths in fsentries are
    // absolute and don't carry a trailing slash, so the prefix pattern is
    // `${prefix}/%`. Scoped by user_id to keep the index tight.
    async listDescendantsByPath(
        userId: number,
        pathPrefix: string,
    ): Promise<FSEntry[]> {
        const normalizedPrefix = this.#normalizePath(pathPrefix);
        if (normalizedPrefix === '/') {
            // Refuse to list all user entries this way — caller must mean something else.
            throw new HttpError(400, 'Refusing to list descendants of root');
        }
        const likePattern = `${this.#escapeLikePattern(normalizedPrefix)}/%`;
        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE user_id = ? AND path LIKE ? ESCAPE '!' ORDER BY path ASC`,
            [userId, likePattern],
        )) as unknown as FSEntryRow[];
        return rows.map((row) => this.#mapFSEntryRow(row));
    }

    async countDescendantsByPath(
        userId: number,
        pathPrefix: string,
    ): Promise<number> {
        const normalizedPrefix = this.#normalizePath(pathPrefix);
        if (normalizedPrefix === '/') return 0;
        const likePattern = `${this.#escapeLikePattern(normalizedPrefix)}/%`;
        const rows = (await this.clients.db.read(
            "SELECT COUNT(*) AS n FROM fsentries WHERE user_id = ? AND path LIKE ? ESCAPE '!'",
            [userId, likePattern],
        )) as unknown as { n: number | string }[];
        return Number(rows[0]?.n ?? 0);
    }

    // Sum of sizes under a path (inclusive). Files only — dirs have null size.
    // NOTE: linear scan under the path prefix index; optimize later if it
    // becomes hot (e.g., incremental size counters or materialized totals).
    async getSubtreeSize(userId: number, pathPrefix: string): Promise<number> {
        const normalizedPrefix = this.#normalizePath(pathPrefix);
        const likePattern =
            normalizedPrefix === '/'
                ? '/%'
                : `${this.#escapeLikePattern(normalizedPrefix)}/%`;
        const rows = (await this.clients.db.read(
            "SELECT COALESCE(SUM(size), 0) AS total FROM fsentries WHERE user_id = ? AND (path = ? OR path LIKE ? ESCAPE '!')",
            [userId, normalizedPrefix, likePattern],
        )) as unknown as { total: number | string }[];
        return Number(rows[0]?.total ?? 0);
    }

    // Simple case-insensitive substring search on name, scoped to one user.
    async searchByNameForUser(
        userId: number,
        query: string,
        limit = 200,
    ): Promise<FSEntry[]> {
        const q = query.trim();
        if (q.length === 0) return [];
        const likePattern = `%${this.#escapeLikePattern(q)}%`;
        const capped = Math.max(1, Math.min(1000, Math.floor(limit)));
        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries
             WHERE user_id = ? AND name LIKE ? ESCAPE '!'
             ORDER BY modified DESC
             LIMIT ${capped}`,
            [userId, likePattern],
        )) as unknown as FSEntryRow[];
        return rows.map((row) => this.#mapFSEntryRow(row));
    }

    // ── Mutation ───────────────────────────────────────────────────────

    // Generic single-entry update. Only a narrow set of columns are patchable
    // through this method; the caller provides the JS-shaped patch and we map.
    async updateEntry(
        uuid: string,
        patch: {
            name?: string;
            path?: string;
            parentId?: number | null;
            parentUid?: string | null;
            thumbnail?: string | null;
            metadata?: string | null;
            isPublic?: boolean | null;
            immutable?: boolean;
            associatedAppId?: number | null;
            layout?: string | null;
            sortBy?: 'name' | 'modified' | 'type' | 'size' | null;
            sortOrder?: 'asc' | 'desc' | null;
            size?: number | null;
            accessed?: number | null;
            modified?: number | null;
        },
    ): Promise<FSEntry> {
        const assignments: string[] = [];
        const values: unknown[] = [];
        const push = (column: string, value: unknown) => {
            assignments.push(`${column} = ?`);
            values.push(value);
        };

        if (patch.name !== undefined) push('name', patch.name);
        if (patch.path !== undefined) push('path', patch.path);
        if (patch.parentId !== undefined) push('parent_id', patch.parentId);
        if (patch.parentUid !== undefined) push('parent_uid', patch.parentUid);
        if (patch.thumbnail !== undefined) push('thumbnail', patch.thumbnail);
        if (patch.metadata !== undefined) push('metadata', patch.metadata);
        if (patch.isPublic !== undefined)
            push(
                'is_public',
                patch.isPublic === null ? null : patch.isPublic ? 1 : 0,
            );
        if (patch.immutable !== undefined)
            push('immutable', patch.immutable ? 1 : 0);
        if (patch.associatedAppId !== undefined)
            push('associated_app_id', patch.associatedAppId);
        if (patch.layout !== undefined) push('layout', patch.layout);
        if (patch.sortBy !== undefined) push('sort_by', patch.sortBy);
        if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
        if (patch.size !== undefined) push('size', patch.size);
        if (patch.accessed !== undefined) push('accessed', patch.accessed);
        // Always bump modified unless caller provides it explicitly.
        push('modified', patch.modified ?? Math.floor(Date.now() / 1000));

        if (assignments.length === 0) {
            const existing = await this.getEntryByUuid(uuid);
            if (!existing) throw new HttpError(404, 'Entry not found');
            return existing;
        }

        await this.clients.db.write(
            `UPDATE fsentries SET ${assignments.join(', ')} WHERE uuid = ?`,
            [...values, uuid],
        );

        const refreshedRows = (await this.clients.db.tryHardRead(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE uuid = ? LIMIT 1`,
            [uuid],
        )) as unknown as FSEntryRow[];
        const row = refreshedRows[0];
        if (!row) {
            throw new HttpError(404, 'Entry not found after update');
        }
        const updated = this.#mapFSEntryRow(row);
        await this.#invalidateEntryCache(updated);
        await this.#writeEntryToCache(updated);
        return updated;
    }

    // Authoritative root lookup. A user's home directory is the row with
    // `parent_uid IS NULL AND user_id = ?`, regardless of what `path`/`name`
    // currently are — legacy rows may have drifted (e.g. stale username after
    // a rename that didn't cascade). Callers use this to heal or rename.
    async getRootEntryForUser(userId: number): Promise<FSEntry | null> {
        const rows = (await this.clients.db.read(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries
             WHERE user_id = ? AND parent_uid IS NULL AND is_dir = 1
             ORDER BY id ASC LIMIT 1`,
            [userId],
        )) as unknown as FSEntryRow[];
        const row = rows[0];
        if (!row) return null;
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    // Heal a user's home tree to `/{username}`: if the root entry's path/name
    // already match, no-op; otherwise rewrite the root row and cascade the
    // prefix to descendants. Used by the username change flow AND by the
    // on-read backfill for legacy users whose root row drifted (or whose
    // path column was never populated).
    async renameUserHome(
        userId: number,
        newUsername: string,
    ): Promise<FSEntry | null> {
        const root = await this.getRootEntryForUser(userId);
        if (!root) return null;

        const newPath = `/${newUsername}`;
        if (root.path === newPath && root.name === newUsername) {
            return root;
        }

        const oldPath = root.path;
        const now = Math.floor(Date.now() / 1000);

        await this.clients.db.write(
            `UPDATE fsentries SET name = ?, path = ?, modified = ?
             WHERE id = ?`,
            [newUsername, newPath, now, root.id],
        );

        if (oldPath && oldPath !== '/' && oldPath !== newPath) {
            const likePattern = `${this.#escapeLikePattern(oldPath)}/%`;
            const oldLen = oldPath.length;
            await this.clients.db.write(
                `UPDATE fsentries
                 SET path = CONCAT(?, SUBSTR(path, ?)),
                     modified = ?
                 WHERE user_id = ? AND path LIKE ? ESCAPE '!'`,
                [newPath, oldLen + 1, now, userId, likePattern],
            );
        }

        // Invalidate root cache under both old and new keys; descendants
        // rely on TTL (60s) to refresh — username rename is rare enough
        // that a broad subtree invalidation isn't worth the round-trips.
        await this.#invalidateEntryCache(root);
        const refreshedRows = (await this.clients.db.tryHardRead(
            `SELECT ${this.#selectFsentriesColumns()} FROM fsentries WHERE id = ? LIMIT 1`,
            [root.id],
        )) as unknown as FSEntryRow[];
        const refreshed = refreshedRows[0]
            ? this.#mapFSEntryRow(refreshedRows[0])
            : null;
        if (refreshed) {
            await this.#invalidateEntryCache(refreshed);
            await this.#writeEntryToCache(refreshed);
        }
        return refreshed;
    }

    // Rewrites path column for every descendant of `oldPrefix` to use `newPrefix`.
    // Used by move/rename when a directory is relocated. Cache for affected
    // entries is invalidated coarsely afterwards by the caller.
    async updatePathPrefixForUser(
        userId: number,
        oldPrefix: string,
        newPrefix: string,
    ): Promise<number> {
        const normalizedOld = this.#normalizePath(oldPrefix);
        const normalizedNew = this.#normalizePath(newPrefix);
        if (normalizedOld === '/' || normalizedNew === '/') {
            throw new HttpError(400, 'Cannot rewrite path prefix to/from root');
        }
        if (normalizedOld === normalizedNew) return 0;

        const likePattern = `${this.#escapeLikePattern(normalizedOld)}/%`;
        const now = Math.floor(Date.now() / 1000);

        // CONCAT(?, SUBSTR(path, ? + 1)) to rewrite just the prefix portion.
        const oldPrefixLen = normalizedOld.length;
        const result = await this.clients.db.write(
            `UPDATE fsentries
             SET path = CONCAT(?, SUBSTR(path, ?)),
                 modified = ?
             WHERE user_id = ? AND path LIKE ? ESCAPE '!'`,
            [normalizedNew, oldPrefixLen + 1, now, userId, likePattern],
        );
        const affected = this.#affectedRows(result);
        return affected;
    }

    async deleteEntry(entry: FSEntry): Promise<void> {
        await this.clients.db.write('DELETE FROM fsentries WHERE id = ?', [
            entry.id,
        ]);
        await this.#invalidateEntryCache(entry);
    }

    async deleteEntries(entries: FSEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const chunks = this.#chunk(entries, BULK_QUERY_CHUNK_SIZE);
        await runWithConcurrencyLimit(
            chunks,
            DEFAULT_DB_CHUNK_CONCURRENCY,
            async (chunk) => {
                const ids = chunk.map((entry) => entry.id);
                const placeholders = ids.map(() => '?').join(', ');
                await this.clients.db.write(
                    `DELETE FROM fsentries WHERE id IN (${placeholders})`,
                    ids,
                );
            },
        );
        // Invalidate caches for all removed entries (best effort).
        await Promise.all(
            entries.map((entry) => this.#invalidateEntryCache(entry)),
        );
    }

    #affectedRows(writeResult: unknown): number {
        if (typeof writeResult !== 'object' || writeResult === null) return 0;
        const record = writeResult as Record<string, unknown>;
        const affected = Number(record.affectedRows ?? record.changes ?? 0);
        return Number.isFinite(affected) ? affected : 0;
    }

    async getUserStorageAllowance(
        userId: number,
    ): Promise<{ curr: number; max: number }> {
        const [usageRows, userRows] = await Promise.all([
            this.clients.db.read(
                'SELECT COALESCE(SUM(size), 0) AS totalUsage FROM fsentries WHERE user_id = ?',
                [userId],
            ) as Promise<{ totalUsage: number }[]>,
            this.clients.db.read(
                'SELECT free_storage AS freeStorage FROM user WHERE id = ? LIMIT 1',
                [userId],
            ) as Promise<{ freeStorage: number | null }[]>,
        ]);
        const usageRow = usageRows[0];
        const userRow = userRows[0];

        const curr = Number(usageRow?.totalUsage ?? 0);
        let max = Number(
            userRow?.freeStorage ?? this.config.storage_capacity ?? 0,
        );

        const event: { userId: number; extra: number } = { userId, extra: 0 };
        try {
            await this.clients.event.emitAndWait(
                'storage.quota.bonus',
                event,
                {},
            );
        } catch {
            /* best-effort */
        }
        if (Number.isFinite(event.extra) && event.extra > 0) {
            max += event.extra;
        }

        if (!this.config.is_storage_limited) {
            const availableDeviceStorage = Number(
                this.config.available_device_storage ?? 0,
            );
            if (availableDeviceStorage > 0) {
                max = availableDeviceStorage;
            } else {
                const freeOnDisk = await this.#getFreeDeviceBytes();
                max =
                    freeOnDisk !== null
                        ? curr + freeOnDisk
                        : Number.MAX_SAFE_INTEGER;
            }
        }

        return { curr, max };
    }

    async #getFreeDeviceBytes(): Promise<number | null> {
        try {
            const stats = await statfs(process.cwd());
            return Number(stats.bavail) * Number(stats.bsize);
        } catch {
            return null;
        }
    }
}
