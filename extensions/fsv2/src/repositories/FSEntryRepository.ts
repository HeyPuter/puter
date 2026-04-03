import type { BaseDatabaseAccessService } from '@heyputer/backend/src/services/database/BaseDatabaseAccessService.js';
import type { DynamoKVStore } from '@heyputer/backend/src/services/DynamoKVStore/DynamoKVStore.js';
import type { Cluster } from 'ioredis';
import { posix as pathPosix } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import {
    FSEntry,
    FSEntryCreateInput,
    PendingUploadCreateInput,
    PendingUploadSession,
} from '../types/FSEntry.js';
import { runWithConcurrencyLimit } from '../utils/concurrency.js';
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

const { HttpError } = extension.import('extensionController');

const ENTRY_CACHE_TTL_SECONDS = 60;
const BULK_QUERY_CHUNK_SIZE = 200;
const DEFAULT_DB_CHUNK_CONCURRENCY = 4;

export class FSEntryRepository {
    #db: BaseDatabaseAccessService;
    #cache: Cluster;
    #kvStore: DynamoKVStore;

    constructor (db: BaseDatabaseAccessService, cache: Cluster, kvStore: DynamoKVStore) {
        this.#db = db;
        this.#cache = cache;
        this.#kvStore = kvStore;
    }

    #insertIgnoreIntoFsentriesSql (): string {
        return this.#db.case({
            sqlite: 'INSERT OR IGNORE INTO fsentries',
            otherwise: 'INSERT IGNORE INTO fsentries',
        });
    }

    #normalizePath (path: string): string {
        const trimmed = path.trim();
        if ( trimmed.length === 0 ) {
            throw new HttpError(400, 'Path cannot be empty');
        }

        let normalized = pathPosix.normalize(trimmed);
        if ( ! normalized.startsWith('/') ) {
            normalized = `/${normalized}`;
        }
        if ( normalized.length > 1 && normalized.endsWith('/') ) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }

    #toBoolean (value: number | boolean | null | undefined): boolean {
        if ( typeof value === 'boolean' ) {
            return value;
        }
        return Number(value ?? 0) === 1;
    }

    #toNullableBoolean (value: number | boolean | null | undefined): boolean | null {
        if ( value === null || value === undefined ) {
            return null;
        }
        return this.#toBoolean(value);
    }

    #mapFSEntryRow (row: FSEntryRow): FSEntry {
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
        };
    }

    #entryCacheKeys (entry: FSEntry): string[] {
        return [
            `prodfsv2:fsentry:id:${entry.id}`,
            `prodfsv2:fsentry:uuid:${entry.uuid}`,
            `prodfsv2:fsentry:path:${entry.userId}:${entry.path}`,
            `prodfsv2:fsentry:path:any:${entry.path}`,
        ];
    }

    async #readEntryFromCache (cacheKey: string): Promise<FSEntry | null> {
        try {
            const cached = await this.#cache.get(cacheKey);
            if ( ! cached ) {
                return null;
            }
            return JSON.parse(cached) as FSEntry;
        } catch {
            return null;
        }
    }

    async #writeEntryToCache (entry: FSEntry): Promise<void> {
        try {
            const serialized = JSON.stringify(entry);
            await Promise.all(this.#entryCacheKeys(entry).map((cacheKey) => {
                return this.#cache.setex(cacheKey, ENTRY_CACHE_TTL_SECONDS, serialized);
            }));
        } catch {
            // Best effort cache write.
        }
    }

    async #invalidateEntryCache (entry: FSEntry): Promise<void> {
        try {
            const keys = this.#entryCacheKeys(entry);
            if ( keys.length > 0 ) {
                await this.#cache.del(...keys);
            }
        } catch {
            // Best effort cache invalidation.
        }
    }

    async invalidateEntryCacheByPathForUser (userId: number, path: string): Promise<void> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKeys: string[] = [
            `prodfsv2:fsentry:path:${userId}:${normalizedPath}`,
            `prodfsv2:fsentry:path:any:${normalizedPath}`,
        ];

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE user_id = ? AND path = ? LIMIT 1',
            [userId, normalizedPath],
        ) as FSEntryRow[];
        const row = rows[0];

        if ( row ) {
            const entry = this.#mapFSEntryRow(row);
            await this.#invalidateEntryCache(entry);
            return;
        }

        try {
            await this.#cache.del(...cacheKeys);
        } catch {
            // Best effort cache invalidation.
        }
    }

    async invalidateEntryCacheByUuid (uuid: string): Promise<void> {
        if ( typeof uuid !== 'string' || uuid.length === 0 ) {
            return;
        }

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE uuid = ? LIMIT 1',
            [uuid],
        ) as FSEntryRow[];
        const row = rows[0];

        if ( row ) {
            const entry = this.#mapFSEntryRow(row);
            await this.#invalidateEntryCache(entry);
            return;
        }

        const cached = await this.#readEntryFromCache(`prodfsv2:fsentry:uuid:${uuid}`);
        if ( cached ) {
            await this.#invalidateEntryCache(cached);
            return;
        }

        try {
            await this.#cache.del(`prodfsv2:fsentry:uuid:${uuid}`);
        } catch {
            // Best effort cache invalidation.
        }
    }

    #chunk<T> (values: T[], size: number): T[][] {
        if ( values.length === 0 ) {
            return [];
        }
        const chunks: T[][] = [];
        for ( let index = 0; index < values.length; index += size ) {
            chunks.push(values.slice(index, index + size));
        }
        return chunks;
    }

    async #writePendingUploadSessions (sessions: PendingUploadSession[], operationName: string): Promise<void> {
        if ( sessions.length === 0 ) {
            return;
        }

        try {
            await this.#kvStore.batchPut({
                items: sessions.map((session) => ({
                    key: toPendingUploadSessionKey(session.sessionId),
                    value: session,
                    expireAt: toPendingUploadSessionExpiresAtSeconds(session.expiresAt),
                })),
            });
        } catch ( error ) {
            if ( error instanceof Error ) {
                throw error;
            }
            throw new Error(`Failed to ${operationName}`);
        }
    }

    async #getPendingUploadSessionsBySessionIds (
        sessionIds: string[],
    ): Promise<Map<string, PendingUploadSession>> {
        const uniqueSessionIds = Array.from(new Set(sessionIds));
        const sessionsById = new Map<string, PendingUploadSession>();
        if ( uniqueSessionIds.length === 0 ) {
            return sessionsById;
        }

        const rawValues = await this.#kvStore.get({
            key: uniqueSessionIds.map((sessionId) => toPendingUploadSessionKey(sessionId)),
        });
        if ( ! Array.isArray(rawValues) ) {
            return sessionsById;
        }

        for ( let index = 0; index < uniqueSessionIds.length; index++ ) {
            const sessionId = uniqueSessionIds[index];
            const rawValue = rawValues[index];
            if ( ! sessionId ) {
                continue;
            }

            const normalizedSession = normalizePendingUploadSession(rawValue, sessionId);
            if ( normalizedSession ) {
                sessionsById.set(sessionId, normalizedSession);
            }
        }

        return sessionsById;
    }

    async #markPendingSessionsWithStatus (
        sessionIds: string[],
        status: PendingUploadSessionStatus,
        reason: string | null,
    ): Promise<void> {
        if ( sessionIds.length === 0 ) {
            return;
        }

        const sessionsById = await this.#getPendingUploadSessionsBySessionIds(sessionIds);
        const now = Date.now();
        const updatedSessions = Array.from(new Set(sessionIds))
            .map((sessionId) => {
                const session = sessionsById.get(sessionId);
                if ( ! session ) {
                    return null;
                }

                return withPendingUploadSessionStatus(session, status, reason, now);
            })
            .filter((session): session is PendingUploadSession => Boolean(session));

        await this.#writePendingUploadSessions(
            updatedSessions,
            `mark pending upload sessions as ${status}`,
        );
    }

    async #readEntriesByPathsForUser (
        userId: number,
        paths: string[],
        options: ReadEntriesByPathsOptions = {},
    ): Promise<Map<string, FSEntry>> {
        const useTryHardRead = Boolean(options.useTryHardRead);
        const skipCache = Boolean(options.skipCache);
        const normalizedPaths = Array.from(new Set(paths
            .map((path) => this.#normalizePath(path))
            .filter((path) => path.length > 0)));
        const entriesByPath = new Map<string, FSEntry>();
        if ( normalizedPaths.length === 0 ) {
            return entriesByPath;
        }

        const missingPaths: string[] = [];
        if ( skipCache ) {
            missingPaths.push(...normalizedPaths);
        } else {
            const cacheReads = await Promise.all(normalizedPaths.map(async (path) => {
                const cacheKey = `prodfsv2:fsentry:path:${userId}:${path}`;
                const cachedEntry = await this.#readEntryFromCache(cacheKey);
                return { path, cachedEntry };
            }));

            for ( const cacheRead of cacheReads ) {
                if ( cacheRead.cachedEntry ) {
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
                if ( chunk.length === 0 ) {
                    return [];
                }

                const placeholders = chunk.map(() => '?').join(', ');
                const rows = (useTryHardRead ? await this.#db.tryHardRead(
                    `SELECT * FROM fsentries WHERE user_id = ? AND path IN (${placeholders})`,
                    [userId, ...chunk],
                ) : await this.#db.read(
                    `SELECT * FROM fsentries WHERE user_id = ? AND path IN (${placeholders})`,
                    [userId, ...chunk],
                )) as FSEntryRow[];

                const entries = rows.map((row) => this.#mapFSEntryRow(row));
                if ( entries.length > 0 ) {
                    await Promise.all(entries.map((entry) => this.#writeEntryToCache(entry)));
                }
                return entries;
            },
        );
        for ( const chunkEntries of chunkResults ) {
            for ( const entry of chunkEntries ) {
                entriesByPath.set(entry.path, entry);
            }
        }

        return entriesByPath;
    }

    #pathDepth (path: string): number {
        return path.split('/').filter(Boolean).length;
    }

    async #ensureDirectoryPathsForUser (
        userId: number,
        requiredPaths: string[],
    ): Promise<{
        requiredEntryMap: Map<string, FSEntry>;
        createdEntryMap: Map<string, FSEntry>;
    }> {
        const normalizedRequiredPaths = Array.from(new Set(requiredPaths
            .map((path) => this.#normalizePath(path))
            .filter((path) => path !== '/')));
        const requiredEntryMap = new Map<string, FSEntry>();
        const createdEntryMap = new Map<string, FSEntry>();
        if ( normalizedRequiredPaths.length === 0 ) {
            return {
                requiredEntryMap,
                createdEntryMap,
            };
        }

        const candidateDirSet = new Set<string>();
        for ( const requiredPath of normalizedRequiredPaths ) {
            let cursor = requiredPath;
            while ( cursor !== '/' ) {
                candidateDirSet.add(cursor);
                cursor = pathPosix.dirname(cursor);
            }
        }

        const candidatePaths = Array.from(candidateDirSet);
        const allEntries = await this.#readEntriesByPathsForUser(userId, candidatePaths);
        for ( const path of candidatePaths ) {
            const entry = allEntries.get(path);
            if ( entry && !entry.isDir ) {
                throw new HttpError(409, `Path is not a directory: ${path}`);
            }
        }

        const missingPaths = candidatePaths
            .filter((path) => !allEntries.has(path))
            .sort((pathA, pathB) => this.#pathDepth(pathA) - this.#pathDepth(pathB));
        if ( missingPaths.length > 0 ) {
            const uniqueDepths = Array.from(new Set(missingPaths.map((path) => this.#pathDepth(path))))
                .sort((depthA, depthB) => depthA - depthB);

            for ( const depth of uniqueDepths ) {
                const pathsAtDepth = missingPaths.filter((path) => this.#pathDepth(path) === depth);
                if ( pathsAtDepth.length === 0 ) {
                    continue;
                }

                const now = Math.floor(Date.now() / 1000);
                const insertRows: unknown[] = [];
                const valuePlaceholders: string[] = [];
                const expectedUuidByPath = new Map<string, string>();
                for ( const dirPath of pathsAtDepth ) {
                    const parentPath = pathPosix.dirname(dirPath);
                    const parentEntry = parentPath === '/'
                        ? null
                        : allEntries.get(parentPath);
                    if ( parentPath !== '/' && !parentEntry ) {
                        throw new Error(`Parent directory not resolved while creating ${dirPath}`);
                    }
                    if ( parentEntry && !parentEntry.isDir ) {
                        throw new HttpError(409, `Path is not a directory: ${parentPath}`);
                    }

                    const expectedUuid = uuidv4();
                    expectedUuidByPath.set(dirPath, expectedUuid);
                    valuePlaceholders.push('(?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 0, 0)');
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
                    await this.#db.write(
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
                for ( const path of pathsAtDepth ) {
                    let insertedEntry = insertedEntries.get(path);
                    if ( ! insertedEntry ) {
                        insertedEntry = await this.#ensureDirectoryPath(path, userId, true);
                    }
                    if ( ! insertedEntry.isDir ) {
                        throw new HttpError(409, `Path is not a directory: ${path}`);
                    }
                    if ( expectedUuidByPath.get(path) === insertedEntry.uuid ) {
                        createdEntryMap.set(path, insertedEntry);
                    }
                    allEntries.set(path, insertedEntry);
                }
            }
        }

        for ( const requiredPath of normalizedRequiredPaths ) {
            const entry = allEntries.get(requiredPath);
            if ( ! entry ) {
                throw new Error(`Failed to resolve directory path: ${requiredPath}`);
            }
            if ( ! entry.isDir ) {
                throw new HttpError(409, `Path is not a directory: ${requiredPath}`);
            }
            requiredEntryMap.set(requiredPath, entry);
        }

        return {
            requiredEntryMap,
            createdEntryMap,
        };
    }

    async #getEntryByPathAndUser (path: string, userId: number): Promise<FSEntry | null> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKey = `prodfsv2:fsentry:path:${userId}:${normalizedPath}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if ( cached ) {
            return cached;
        }

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE path = ? AND user_id = ? LIMIT 1',
            [normalizedPath, userId],
        ) as FSEntryRow[];
        const row = rows[0];
        if ( ! row ) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async #ensureDirectoryPath (path: string, userId: number, createPaths: boolean): Promise<FSEntry> {
        const normalizedPath = this.#normalizePath(path);

        const existingEntry = await this.#getEntryByPathAndUser(normalizedPath, userId);
        if ( existingEntry ) {
            if ( ! existingEntry.isDir ) {
                throw new HttpError(409, `Path is not a directory: ${normalizedPath}`);
            }
            return existingEntry;
        }

        if ( ! createPaths ) {
            throw new HttpError(404, `Parent path does not exist: ${normalizedPath}`);
        }

        if ( normalizedPath === '/' ) {
            throw new HttpError(400, 'Cannot create root directory');
        }

        const parentPath = pathPosix.dirname(normalizedPath);
        const parentEntry = parentPath === '/'
            ? null
            : await this.#ensureDirectoryPath(parentPath, userId, true);
        const dirName = pathPosix.basename(normalizedPath);
        const now = Math.floor(Date.now() / 1000);

        try {
            await this.#db.write(
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
        if ( ! resolvedEntry ) {
            throw new Error(`Failed to resolve directory path: ${normalizedPath}`);
        }
        if ( ! resolvedEntry.isDir ) {
            throw new HttpError(409, `Path is not a directory: ${normalizedPath}`);
        }

        return resolvedEntry;
    }

    #serializeMetadata (input: FSEntryCreateInput): string | null {
        if ( typeof input.metadata === 'string' ) {
            return input.metadata;
        }

        const metadataObject: Record<string, unknown> =
            input.metadata && typeof input.metadata === 'object'
                ? { ...input.metadata }
                : {};

        if ( input.contentType ) {
            metadataObject.contentType = input.contentType;
        }
        if ( input.checksumSha256 ) {
            metadataObject.checksumSha256 = input.checksumSha256;
        }

        if ( Object.keys(metadataObject).length === 0 ) {
            return null;
        }

        return JSON.stringify(metadataObject);
    }

    async getEntryByPath (path: string): Promise<FSEntry | null> {
        const normalizedPath = this.#normalizePath(path);
        const cacheKey = `prodfsv2:fsentry:path:any:${normalizedPath}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if ( cached ) {
            return cached;
        }

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE path = ? LIMIT 1',
            [normalizedPath],
        ) as FSEntryRow[];
        const row = rows[0];
        if ( ! row ) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async getEntriesByPaths (paths: string[]): Promise<Map<string, FSEntry>> {
        const normalizedPaths = Array.from(new Set(
            paths.map((path) => this.#normalizePath(path)).filter((path) => path.length > 0),
        ));
        const entriesByPath = new Map<string, FSEntry>();
        if ( normalizedPaths.length === 0 ) {
            return entriesByPath;
        }

        const missingPaths: string[] = [];
        const cacheReads = await Promise.all(normalizedPaths.map(async (path) => {
            const cacheKey = `prodfsv2:fsentry:path:any:${path}`;
            const cachedEntry = await this.#readEntryFromCache(cacheKey);
            return { path, cachedEntry };
        }));
        for ( const { path, cachedEntry } of cacheReads ) {
            if ( cachedEntry ) {
                entriesByPath.set(path, cachedEntry);
            } else {
                missingPaths.push(path);
            }
        }

        if ( missingPaths.length > 0 ) {
            const chunks = this.#chunk(missingPaths, BULK_QUERY_CHUNK_SIZE);
            const chunkResults = await runWithConcurrencyLimit(
                chunks,
                DEFAULT_DB_CHUNK_CONCURRENCY,
                async (chunk) => {
                    if ( chunk.length === 0 ) {
                        return [];
                    }
                    const placeholders = chunk.map(() => '?').join(', ');
                    const rows = await this.#db.read(
                        `SELECT * FROM fsentries WHERE path IN (${placeholders})`,
                        chunk,
                    ) as FSEntryRow[];
                    const entries = rows.map((row) => this.#mapFSEntryRow(row));
                    await Promise.all(entries.map((entry) => this.#writeEntryToCache(entry)));
                    return entries;
                },
            );
            for ( const chunkEntries of chunkResults ) {
                for ( const entry of chunkEntries ) {
                    entriesByPath.set(entry.path, entry);
                }
            }
        }

        return entriesByPath;
    }

    async getEntryByUuid (id: string): Promise<FSEntry | null> {
        const cacheKey = `prodfsv2:fsentry:uuid:${id}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if ( cached ) {
            return cached;
        }

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE uuid = ? LIMIT 1',
            [id],
        ) as FSEntryRow[];
        const row = rows[0];
        if ( ! row ) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async getEntryById (id: number): Promise<FSEntry | null> {
        const cacheKey = `prodfsv2:fsentry:id:${id}`;
        const cached = await this.#readEntryFromCache(cacheKey);
        if ( cached ) {
            return cached;
        }

        const rows = await this.#db.read(
            'SELECT * FROM fsentries WHERE id = ? LIMIT 1',
            [id],
        ) as FSEntryRow[];
        const row = rows[0];
        if ( ! row ) {
            return null;
        }
        const entry = this.#mapFSEntryRow(row);
        await this.#writeEntryToCache(entry);
        return entry;
    }

    async updateEntryThumbnailByUuidForUser (userId: number, uuid: string, thumbnail: string | null): Promise<FSEntry> {
        const now = Math.floor(Date.now() / 1000);
        const writeResult = await this.#db.write(
            `UPDATE fsentries
             SET thumbnail = ?,
                 modified = ?,
                 accessed = ?
             WHERE uuid = ? AND user_id = ?`,
            [thumbnail, now, now, uuid, userId],
        );
        if ( typeof writeResult === 'object' && writeResult !== null ) {
            const writeResultRecord = writeResult as Record<string, unknown>;
            const anyRowsAffected = writeResultRecord.anyRowsAffected;
            if ( typeof anyRowsAffected === 'boolean' && !anyRowsAffected ) {
                throw new HttpError(404, 'File entry was not found for thumbnail update');
            }

            const affectedRowsRaw = writeResultRecord.affectedRows;
            const affectedRows = Number(affectedRowsRaw);
            if (
                affectedRowsRaw !== undefined
                && Number.isFinite(affectedRows)
                && affectedRows <= 0
            ) {
                throw new HttpError(404, 'File entry was not found for thumbnail update');
            }
        }

        const refreshedRows = await this.#db.tryHardRead(
            'SELECT * FROM fsentries WHERE uuid = ? AND user_id = ? LIMIT 1',
            [uuid, userId],
        ) as FSEntryRow[];
        const refreshedRow = refreshedRows[0];
        if ( ! refreshedRow ) {
            throw new HttpError(404, 'File entry was not found for thumbnail update');
        }

        const updatedEntry = this.#mapFSEntryRow(refreshedRow);
        await this.#invalidateEntryCache(updatedEntry);
        await this.#writeEntryToCache(updatedEntry);
        return updatedEntry;
    }

    async resolveParentDirectory (userId: number, parentPath: string, createPaths: boolean): Promise<FSEntry> {
        return this.#ensureDirectoryPath(parentPath, userId, createPaths);
    }

    async getEntryByPathForUser (
        path: string,
        userId: number,
        options: ReadEntriesByPathsOptions = {},
    ): Promise<FSEntry | null> {
        if ( !options.useTryHardRead && !options.skipCache ) {
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

    async getEntriesByPathsForUser (
        userId: number,
        paths: string[],
        options: ReadEntriesByPathsOptions = {},
    ): Promise<(FSEntry | null)[]> {
        const entriesByPath = await this.#readEntriesByPathsForUser(userId, paths, options);
        return paths.map((path) => {
            const normalizedPath = this.#normalizePath(path);
            return entriesByPath.get(normalizedPath) ?? null;
        });
    }

    async resolveParentDirectoriesBatch (
        userId: number,
        requests: { parentPath: string; createPaths: boolean }[],
    ): Promise<FSEntry[]> {
        const { parentEntries } = await this.resolveParentDirectoriesBatchWithCreated(userId, requests);
        return parentEntries;
    }

    async resolveParentDirectoriesBatchWithCreated (
        userId: number,
        requests: { parentPath: string; createPaths: boolean }[],
    ): Promise<{
        parentEntries: FSEntry[];
        createdDirectoryEntries: FSEntry[];
    }> {
        if ( requests.length === 0 ) {
            return {
                parentEntries: [],
                createdDirectoryEntries: [],
            };
        }

        const parentPathsToEnsure = requests
            .filter((request) => request.createPaths)
            .map((request) => request.parentPath);
        const { createdEntryMap } = await this.#ensureDirectoryPathsForUser(userId, parentPathsToEnsure);

        const allParentPaths = requests.map((request) => request.parentPath);
        const parentEntriesByPath = await this.#readEntriesByPathsForUser(userId, allParentPaths);
        const parentEntries = allParentPaths.map((path) => {
            const normalizedPath = this.#normalizePath(path);
            const parentEntry = parentEntriesByPath.get(normalizedPath);
            if ( ! parentEntry ) {
                throw new HttpError(404, `Parent path does not exist: ${normalizedPath}`);
            }
            if ( ! parentEntry.isDir ) {
                throw new HttpError(409, `Path is not a directory: ${normalizedPath}`);
            }
            return parentEntry;
        });

        return {
            parentEntries,
            createdDirectoryEntries: Array.from(createdEntryMap.values()),
        };
    }

    async ensureDirectoriesForUser (
        userId: number,
        requests: { path: string; createPaths: boolean }[],
    ): Promise<FSEntry[]> {
        const { entries } = await this.ensureDirectoriesForUserWithCreated(userId, requests);
        return entries;
    }

    async ensureDirectoriesForUserWithCreated (
        userId: number,
        requests: { path: string; createPaths: boolean }[],
    ): Promise<{
        entries: FSEntry[];
        createdDirectoryEntries: FSEntry[];
    }> {
        if ( requests.length === 0 ) {
            return {
                entries: [],
                createdDirectoryEntries: [],
            };
        }

        const normalizedRequests = requests.map((request) => {
            const normalizedPath = this.#normalizePath(request.path);
            if ( normalizedPath === '/' ) {
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
        const { createdEntryMap } = await this.#ensureDirectoryPathsForUser(userId, pathsToEnsure);

        const allPaths = normalizedRequests.map((request) => request.path);
        const entriesByPath = await this.#readEntriesByPathsForUser(userId, allPaths);

        const entries = normalizedRequests.map((request) => {
            const entry = entriesByPath.get(request.path);
            if ( ! entry ) {
                throw new HttpError(404, `Directory path does not exist: ${request.path}`);
            }
            if ( ! entry.isDir ) {
                throw new HttpError(409, `Path is not a directory: ${request.path}`);
            }
            return entry;
        });

        return {
            entries,
            createdDirectoryEntries: Array.from(createdEntryMap.values()),
        };
    }

    async createEntry (fsEntry: FSEntryCreateInput, createPaths = true): Promise<FSEntry> {
        const [entry] = await this.batchCreateEntries([fsEntry], createPaths);
        if ( ! entry ) {
            throw new Error('Failed to create entry');
        }
        return entry;
    }

    async batchCreateEntries (entries: FSEntryCreateInput[], createPaths = true): Promise<FSEntry[]> {
        if ( entries.length === 0 ) {
            return [];
        }

        const normalizedEntries: NormalizedEntryWrite[] = entries.map((entryInput, index) => {
            const targetPath = this.#normalizePath(entryInput.path);
            if ( targetPath === '/' ) {
                throw new HttpError(400, 'Cannot write to root path');
            }

            const parentPath = this.#normalizePath(pathPosix.dirname(targetPath));
            if ( parentPath === '/' ) {
                throw new HttpError(400, 'Cannot write directly under root path');
            }

            const size = Number(entryInput.size);
            if ( Number.isNaN(size) || size < 0 ) {
                throw new HttpError(400, `Invalid size for path ${targetPath}`);
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
        });

        const duplicatePathSet = new Set<string>();
        for ( const normalizedEntry of normalizedEntries ) {
            const dedupeKey = `${normalizedEntry.userId}:${normalizedEntry.targetPath}`;
            if ( duplicatePathSet.has(dedupeKey) ) {
                throw new HttpError(409, `Batch contains duplicate target path: ${normalizedEntry.targetPath}`);
            }
            duplicatePathSet.add(dedupeKey);
        }

        const entriesByUser = new Map<number, NormalizedEntryWrite[]>();
        for ( const normalizedEntry of normalizedEntries ) {
            const userEntries = entriesByUser.get(normalizedEntry.userId) ?? [];
            userEntries.push(normalizedEntry);
            entriesByUser.set(normalizedEntry.userId, userEntries);
        }

        const resultsByIndex = new Map<number, FSEntry>();
        for ( const [userId, userEntries] of entriesByUser ) {
            const parentEntries = await this.resolveParentDirectoriesBatch(
                userId,
                userEntries.map((entry) => ({
                    parentPath: entry.parentPath,
                    createPaths: entry.createPaths,
                })),
            );
            const parentByPath = new Map<string, FSEntry>();
            for ( const parentEntry of parentEntries ) {
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

            for ( const entry of userEntries ) {
                const parentEntry = parentByPath.get(entry.parentPath);
                if ( ! parentEntry ) {
                    throw new Error(`Failed to resolve parent directory for ${entry.targetPath}`);
                }

                const existingEntry = existingEntriesByPath.get(entry.targetPath);
                if ( existingEntry ) {
                    if ( ! entry.input.overwrite ) {
                        throw new HttpError(409, `Entry already exists at ${entry.targetPath}`);
                    }
                    if ( existingEntry.isDir ) {
                        throw new HttpError(409, `Cannot overwrite a directory at ${entry.targetPath}`);
                    }

                    const updatedEntry = {
                        ...existingEntry,
                        bucket: entry.bucket,
                        bucketRegion: entry.bucketRegion,
                        parentId: parentEntry.id,
                        parentUid: parentEntry.uuid,
                        associatedAppId: entry.input.associatedAppId ?? null,
                        isPublic: entry.input.isPublic === undefined ? null : Boolean(entry.input.isPublic),
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
                        promise: this.#db.write(
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
                                entry.input.isPublic === undefined ? null : (entry.input.isPublic ? 1 : 0),
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

            if ( updateOperations.length > 0 ) {
                const updateResults = await Promise.allSettled(updateOperations.map((operation) => operation.promise));
                const successfulUpdateOperations = updateResults.flatMap((result, index) => {
                    if ( result.status !== 'fulfilled' ) {
                        return [];
                    }
                    const operation = updateOperations[index];
                    return operation ? [operation] : [];
                });
                if ( successfulUpdateOperations.length > 0 ) {
                    await Promise.all(successfulUpdateOperations.map((operation) => {
                        return this.#invalidateEntryCache(operation.existingEntry);
                    }));
                    await Promise.all(successfulUpdateOperations.map((operation) => {
                        return this.#writeEntryToCache(operation.updatedEntry);
                    }));
                }

                const failedUpdate = updateResults.find((result) => result.status === 'rejected');
                if ( failedUpdate?.status === 'rejected' ) {
                    throw (failedUpdate.reason instanceof Error
                        ? failedUpdate.reason
                        : new Error('Failed to update fsentries batch'));
                }
            }

            const insertChunks = this.#chunk(insertCandidates, BULK_QUERY_CHUNK_SIZE);
            await runWithConcurrencyLimit(
                insertChunks,
                DEFAULT_DB_CHUNK_CONCURRENCY,
                async (insertChunk) => {
                    if ( insertChunk.length === 0 ) {
                        return;
                    }

                    const valuePlaceholders: string[] = [];
                    const values: unknown[] = [];
                    for ( const entry of insertChunk ) {
                        const parentEntry = parentByPath.get(entry.parentPath);
                        if ( ! parentEntry ) {
                            throw new Error(`Failed to resolve parent directory for ${entry.targetPath}`);
                        }

                        valuePlaceholders.push('(?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                        values.push(
                            entry.input.uuid,
                            entry.bucket,
                            entry.bucketRegion,
                            userId,
                            parentEntry.id,
                            parentEntry.uuid,
                            entry.input.associatedAppId ?? null,
                            entry.input.isPublic === undefined ? null : (entry.input.isPublic ? 1 : 0),
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

                    await this.#db.write(
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
            if ( insertCandidates.length > 0 ) {
                const insertUuidChunks = this.#chunk(
                    insertCandidates.map((entry) => entry.input.uuid),
                    BULK_QUERY_CHUNK_SIZE,
                );

                const insertedChunkResults = await runWithConcurrencyLimit(
                    insertUuidChunks,
                    DEFAULT_DB_CHUNK_CONCURRENCY,
                    async (insertUuidChunk) => {
                        if ( insertUuidChunk.length === 0 ) {
                            return [];
                        }

                        const placeholders = insertUuidChunk.map(() => '?').join(', ');
                        const rows = await this.#db.tryHardRead(
                            `SELECT * FROM fsentries WHERE user_id = ? AND uuid IN (${placeholders})`,
                            [userId, ...insertUuidChunk],
                        ) as FSEntryRow[];

                        const insertedEntries = rows.map((row) => this.#mapFSEntryRow(row));
                        if ( insertedEntries.length > 0 ) {
                            await Promise.all(insertedEntries.map((entry) => this.#writeEntryToCache(entry)));
                        }
                        return insertedEntries;
                    },
                );
                for ( const insertedEntries of insertedChunkResults ) {
                    for ( const insertedEntry of insertedEntries ) {
                        insertedEntriesByUuid.set(insertedEntry.uuid, insertedEntry);
                    }
                }
            }

            for ( const entry of userEntries ) {
                const updatedResult = updatedResultsByIndex.get(entry.index);
                if ( updatedResult ) {
                    resultsByIndex.set(entry.index, updatedResult);
                    continue;
                }

                const insertedResult = insertedEntriesByUuid.get(entry.input.uuid);
                if ( insertedResult ) {
                    resultsByIndex.set(entry.index, insertedResult);
                    continue;
                }

                throw new Error(`Failed to load final entry for ${entry.targetPath}`);
            }
        }

        const createdEntries: FSEntry[] = [];
        for ( let index = 0; index < entries.length; index++ ) {
            const entry = resultsByIndex.get(index);
            if ( ! entry ) {
                throw new Error(`Failed to resolve entry result at index ${index}`);
            }
            createdEntries.push(entry);
        }
        return createdEntries;
    }

    async createPendingEntry (entry: PendingUploadCreateInput): Promise<PendingUploadSession> {
        const [createdEntry] = await this.batchCreatePendingEntries([entry]);
        if ( ! createdEntry ) {
            throw new Error('Failed to create pending upload entry');
        }
        return createdEntry;
    }

    async batchCreatePendingEntries (entries: PendingUploadCreateInput[]): Promise<PendingUploadSession[]> {
        if ( entries.length === 0 ) {
            return [];
        }
        const now = Date.now();
        const pendingSessions = entries.map((entry) => toPendingUploadSession(entry, now));
        await this.#writePendingUploadSessions(pendingSessions, 'create pending upload sessions');
        return pendingSessions;
    }

    async getPendingEntryBySessionId (sessionId: string): Promise<PendingUploadSession | null> {
        const value = await this.#kvStore.get({
            key: toPendingUploadSessionKey(sessionId),
        });
        return normalizePendingUploadSession(value, sessionId);
    }

    async getPendingEntriesBySessionIds (sessionIds: string[]): Promise<(PendingUploadSession | null)[]> {
        if ( sessionIds.length === 0 ) {
            return [];
        }

        const entriesBySessionId = await this.#getPendingUploadSessionsBySessionIds(sessionIds);
        return sessionIds.map((sessionId) => entriesBySessionId.get(sessionId) ?? null);
    }

    async markPendingEntryCompleted (sessionId: string): Promise<void> {
        await this.#markPendingSessionsWithStatus([sessionId], 'completed', null);
    }

    async markPendingEntryFailed (sessionId: string, reason: string): Promise<void> {
        await this.#markPendingSessionsWithStatus([sessionId], 'failed', reason);
    }

    async markPendingEntriesFailed (sessionIds: string[], reason: string): Promise<void> {
        await this.#markPendingSessionsWithStatus(sessionIds, 'failed', reason);
    }

    async abortPendingEntry (sessionId: string, reason: string): Promise<void> {
        await this.#markPendingSessionsWithStatus([sessionId], 'aborted', reason);
    }

    async completePendingEntry (sessionId: string, finalData: FSEntryCreateInput): Promise<FSEntry> {
        const [completedEntry] = await this.batchCompletePendingEntries([{ sessionId, finalData }]);
        if ( ! completedEntry ) {
            throw new Error('Failed to complete pending entry');
        }
        return completedEntry;
    }

    async batchCompletePendingEntries (
        entries: { sessionId: string; finalData: FSEntryCreateInput }[],
    ): Promise<FSEntry[]> {
        if ( entries.length === 0 ) {
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

    async getUserStorageAllowance (userId: number): Promise<{ curr: number; max: number }> {
        const [usageRows, userRows] = await Promise.all([
            this.#db.read(
                'SELECT COALESCE(SUM(size), 0) AS totalUsage FROM fsentries WHERE user_id = ?',
                [userId],
            ) as Promise<{ totalUsage: number }[]>,
            this.#db.read(
                'SELECT free_storage AS freeStorage FROM user WHERE id = ? LIMIT 1',
                [userId],
            ) as Promise<{ freeStorage: number | null }[]>,
        ]);
        const usageRow = usageRows[0];
        const userRow = userRows[0];

        const curr = Number(usageRow?.totalUsage ?? 0);
        let max = Number(userRow?.freeStorage ?? global_config.storage_capacity ?? 0);

        if ( ! global_config.is_storage_limited ) {
            const availableDeviceStorage = Number(global_config.available_device_storage ?? 0);
            max = availableDeviceStorage > 0 ? availableDeviceStorage : Number.MAX_SAFE_INTEGER;
        }

        return { curr, max };
    }
}
