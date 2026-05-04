/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { existsSync, readFileSync } from 'fs';
import { basename, extname, join, resolve } from 'path';
import { createContext, runInContext } from 'vm';
import { AbstractDatabaseClient, type WriteResult } from './DatabaseClient';
import type { IConfig } from '../../types';

const MIGRATIONS_DIR = resolve(__dirname, './migrations/sqlite');

/**
 * Ordered list of [threshold_version, files[]] pairs.
 * A database whose `user_version` is <= threshold_version will have
 * the corresponding files applied.
 */
const AVAILABLE_MIGRATIONS: [number, string[]][] = [
    [-1, ['0001_create-tables.sql', '0002_add-default-apps.sql']],
    [0, ['0003_user-permissions.sql']],
    [1, ['0004_sessions.sql']],
    [2, ['0005_background-apps.sql']],
    [3, ['0006_update-apps.sql']],
    [4, ['0007_sessions.sql']],
    [5, ['0008_otp.sql']],
    [6, ['0009_app-prefix-fix.sql']],
    [7, ['0010_add-git-app.sql']],
    [8, ['0011_notification.sql']],
    [9, ['0012_appmetadata.sql']],
    [10, ['0013_protected-apps.sql']],
    [11, ['0014_share.sql']],
    [12, ['0015_group.sql']],
    [13, ['0016_group-permissions.sql']],
    [14, ['0017_publicdirs.sql']],
    [15, ['0018_fix-0003.sql']],
    [16, ['0019_fix-0016.sql']],
    [17, ['0020_dev-center.sql']],
    [18, ['0021_app-owner-id.sql']],
    [19, ['0022_dev-center-max.sql']],
    [20, ['0023_fix-kv.sql']],
    [21, ['0024_default-groups.sql']],
    [22, ['0025_system-user.dbmig.js']],
    [23, ['0026_user-groups.dbmig.js']],
    // 24 is skipped (0027 only registered in some branches)
    [25, ['0028_clean-email.sql']],
    // 26 skipped
    [27, ['0030_comments.sql']],
    [28, ['0031_audit-meta.sql']],
    [29, ['0032_signup_metadata.sql']],
    [30, ['0033_ai-usage.sql']],
    [31, ['0034_app-redirect.sql']],
    [32, ['0035_threads.sql']],
    [33, ['0036_dev-to-app.sql']],
    [34, ['0038_custom-domains.sql']],
    [35, ['0039_add-expireAt-to-kv-store.sql']],
    [36, ['0040_add_user_metadata.sql']],
    [37, ['0041_add_unique_constraint_user_uuid.sql']],
    [38, ['0042_add_cloudflare_d1.sql']],
    [39, ['0043_add_dt.sql']],
    [40, ['0044_dev-center-godmode.sql']],
    [41, ['0045_user_oidc_providers.sql']],
    [42, ['0046_is-private-apps.sql']],
];

export class SqliteDatabaseClient extends AbstractDatabaseClient {
    override readonly engineName = 'sqlite';

    // better-sqlite3 instance — set during onServerStart
    private db!: InstanceType<typeof import('better-sqlite3')>;

    constructor(config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    override async onServerStart(): Promise<void> {
        const Database = (await import('better-sqlite3')).default;

        const dbPath = this.config.database?.path ?? ':memory:';
        const isNew = dbPath === ':memory:' || !existsSync(dbPath);

        this.db = new Database(dbPath);

        await this.runMigrations(isNew);
    }

    override onServerShutdown(): void {
        if (this.db) {
            this.db.close();
        }
    }

    // ------------------------------------------------------------------
    // Query interface
    // ------------------------------------------------------------------

    override async read(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        query = this.transformQuery(query);
        params = this.transformParams(params);
        return this.db.prepare(query).all(...params) as Record<
            string,
            unknown
        >[];
    }

    override async pread(
        query: string,
        params: unknown[] = [],
    ): Promise<Record<string, unknown>[]> {
        // SQLite is single-node — pread is identical to read
        return this.read(query, params);
    }

    override async write(
        query: string,
        params: unknown[] = [],
    ): Promise<WriteResult> {
        query = this.transformQuery(query);
        params = this.transformParams(params);

        const info = this.db.prepare(query).run(...params);

        return {
            insertId: info.lastInsertRowid,
            affectedRows: info.changes,
            anyRowsAffected: info.changes > 0,
        };
    }

    override async batchWrite(
        entries: { statement: string; values: unknown[] }[],
    ): Promise<void> {
        this.db.transaction(() => {
            for (let { statement, values } of entries) {
                statement = this.transformQuery(statement);
                values = this.transformParams(values);
                this.db.prepare(statement).run(...values);
            }
        })();
    }

    // ------------------------------------------------------------------
    // SQLite-specific transforms
    // ------------------------------------------------------------------

    private transformQuery(query: string): string {
        return query.replace(/now\(\)/gi, "datetime('now')");
    }

    private transformParams(params: unknown[]): unknown[] {
        return params.map((p) => {
            if (typeof p === 'boolean') return p ? 1 : 0;
            return p;
        });
    }

    // ------------------------------------------------------------------
    // Migration system
    // ------------------------------------------------------------------

    private async runMigrations(isNew: boolean): Promise<void> {
        const highestVersion =
            AVAILABLE_MIGRATIONS[AVAILABLE_MIGRATIONS.length - 1][0] + 1;
        const targetVersion =
            this.config.database?.targetVersion ?? highestVersion;

        const userVersion = isNew ? -1 : this.getEffectiveUserVersion();

        console.log(`[sqlite] database version: ${userVersion}`);

        const toApply: string[] = [];
        for (const [threshold, files] of AVAILABLE_MIGRATIONS) {
            if (
                threshold + 1 >= targetVersion &&
                targetVersion !== highestVersion
            ) {
                console.warn(
                    `[sqlite] early exit: target version set to ${targetVersion}`,
                );
                break;
            }
            if (userVersion <= threshold) {
                toApply.push(...files);
            }
        }

        if (toApply.length === 0) return;

        console.log(
            `[sqlite] upgrading database: ${userVersion} -> ${targetVersion} (${toApply.length} migration files)`,
        );

        for (const file of toApply) {
            const filePath = join(MIGRATIONS_DIR, file);
            const contents = readFileSync(filePath, 'utf8');
            const ext = extname(file);
            const name = basename(file);

            switch (ext) {
                case '.sql':
                    this.applySqlMigration(name, contents);
                    break;
                case '.js':
                    await this.applyJsMigration(name, contents);
                    break;
                default:
                    throw new Error(
                        `[sqlite] unrecognised migration type: ${file}`,
                    );
            }
        }

        this.db.exec(`PRAGMA user_version = ${targetVersion};`);
        console.log(`[sqlite] database upgraded to version ${targetVersion}`);
    }

    private getEffectiveUserVersion(): number {
        const userVersion = (
            this.db.prepare('PRAGMA user_version').get() as {
                user_version: number;
            }
        ).user_version;
        if (userVersion !== 0) return userVersion;

        const hasAppsTable = this.hasTable('apps');
        const hasUserTable = this.hasTable('user');

        if (!hasAppsTable || !hasUserTable) {
            console.warn(
                '[sqlite] user_version=0 but bootstrap tables are missing; treating database as uninitialized',
            );
            return -1;
        }

        const inferredUserVersion = this.inferLegacyUserVersion();
        if (inferredUserVersion !== 0) {
            console.warn(
                `[sqlite] user_version=0; inferred legacy schema version ${inferredUserVersion}`,
            );
        }

        return inferredUserVersion;
    }

    private inferLegacyUserVersion(): number {
        const markers: Array<{ version: number; check: () => boolean }> = [
            {
                version: 1,
                check: () =>
                    this.hasTable('user_to_user_permissions') &&
                    this.hasTable('audit_user_to_user_permissions'),
            },
            {
                version: 2,
                check: () => this.hasTable('sessions'),
            },
            {
                version: 3,
                check: () => this.hasColumn('apps', 'background'),
            },
            {
                version: 5,
                check: () =>
                    this.hasColumn('sessions', 'created_at') &&
                    this.hasColumn('sessions', 'last_activity'),
            },
            {
                version: 6,
                check: () =>
                    this.hasColumn('user', 'otp_secret') &&
                    this.hasColumn('user', 'otp_enabled') &&
                    this.hasColumn('user', 'otp_recovery_codes'),
            },
            {
                version: 8,
                check: () =>
                    this.hasRow('SELECT 1 FROM `apps` WHERE `uid` = ?', [
                        'app-e3ac5486-da8c-42ad-8377-8728086e0980',
                    ]),
            },
            {
                version: 9,
                check: () => this.hasTable('notification'),
            },
            {
                version: 10,
                check: () => this.hasColumn('apps', 'metadata'),
            },
            {
                version: 11,
                check: () =>
                    this.hasColumn('apps', 'protected') &&
                    this.hasColumn('subdomains', 'protected'),
            },
            {
                version: 12,
                check: () => this.hasTable('share'),
            },
            {
                version: 13,
                check: () =>
                    this.hasTable('group') && this.hasTable('jct_user_group'),
            },
            {
                version: 14,
                check: () =>
                    this.hasTable('user_to_group_permissions') &&
                    this.hasTable('audit_user_to_group_permissions'),
            },
            {
                version: 15,
                check: () =>
                    this.hasColumn('user', 'public_uuid') &&
                    this.hasColumn('user', 'public_id'),
            },
            {
                version: 16,
                check: () =>
                    this.columnAllowsNull(
                        'audit_user_to_user_permissions',
                        'issuer_user_id',
                    ) &&
                    this.columnAllowsNull(
                        'audit_user_to_user_permissions',
                        'holder_user_id',
                    ),
            },
            {
                version: 17,
                check: () =>
                    this.columnAllowsNull(
                        'audit_user_to_group_permissions',
                        'user_id',
                    ) &&
                    this.columnAllowsNull(
                        'audit_user_to_group_permissions',
                        'group_id',
                    ),
            },
            {
                version: 18,
                check: () =>
                    this.hasRow('SELECT 1 FROM `apps` WHERE `uid` = ?', [
                        'app-0b37f054-07d4-4627-8765-11bd23e889d4',
                    ]),
            },
            {
                version: 21,
                check: () => this.columnTypeIs('kv', 'value', 'JSON'),
            },
            {
                version: 22,
                check: () =>
                    this.hasRow('SELECT 1 FROM `group` WHERE `uid` = ?', [
                        '26bfb1fb-421f-45bc-9aa4-d81ea569e7a5',
                    ]),
            },
            {
                version: 23,
                check: () =>
                    this.hasRow('SELECT 1 FROM `user` WHERE `uuid` = ?', [
                        '5d4adce0-a381-4982-9c02-6e2540026238',
                    ]),
            },
            {
                version: 24,
                check: () =>
                    this.hasRow('SELECT 1 FROM `group` WHERE `uid` = ?', [
                        'b7220104-7905-4985-b996-649fdcdb3c8f',
                    ]),
            },
            {
                version: 26,
                check: () => this.hasColumn('user', 'clean_email'),
            },
            {
                version: 28,
                check: () => this.hasTable('user_comments'),
            },
            {
                version: 29,
                check: () => this.hasColumn('user', 'audit_metadata'),
            },
            {
                version: 30,
                check: () => this.hasColumn('user', 'signup_ip'),
            },
            {
                version: 31,
                check: () => this.hasTable('ai_usage'),
            },
            {
                version: 32,
                check: () => this.hasTable('old_app_names'),
            },
            {
                version: 33,
                check: () => this.hasTable('thread'),
            },
            {
                version: 34,
                check: () =>
                    this.hasTable('dev_to_app_permissions') &&
                    this.hasTable('audit_dev_to_app_permissions'),
            },
            {
                version: 35,
                check: () => this.hasColumn('subdomains', 'domain'),
            },
            {
                version: 36,
                check: () => this.hasColumn('kv', 'expireAt'),
            },
            {
                version: 37,
                check: () => this.hasColumn('user', 'metadata'),
            },
            {
                version: 39,
                check: () => this.hasColumn('subdomains', 'database_id'),
            },
            {
                version: 40,
                check: () => this.hasColumn('user_to_app_permissions', 'dt'),
            },
            {
                version: 42,
                check: () => this.hasTable('user_oidc_providers'),
            },
            {
                version: 43,
                check: () => this.hasColumn('apps', 'is_private'),
            },
        ];

        let inferredUserVersion = 0;

        for (const marker of markers) {
            if (marker.check()) {
                inferredUserVersion = marker.version;
            }
        }

        return inferredUserVersion;
    }

    private hasTable(table: string): boolean {
        return Boolean(
            this.db
                .prepare(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                )
                .get(table),
        );
    }

    private hasColumn(table: string, column: string): boolean {
        return Boolean(
            this.db
                .prepare(
                    `SELECT 1 FROM pragma_table_info(${this.quoteSqlString(table)}) WHERE name = ?`,
                )
                .get(column),
        );
    }

    private columnAllowsNull(table: string, column: string): boolean {
        const info = this.db
            .prepare(
                `SELECT * FROM pragma_table_info(${this.quoteSqlString(table)}) WHERE name = ?`,
            )
            .get(column) as { notnull: number } | undefined;

        return info?.notnull === 0;
    }

    private columnTypeIs(table: string, column: string, type: string): boolean {
        const info = this.db
            .prepare(
                `SELECT type FROM pragma_table_info(${this.quoteSqlString(table)}) WHERE name = ?`,
            )
            .get(column) as { type: string } | undefined;

        return info?.type?.toUpperCase() === type.toUpperCase();
    }

    private hasRow(query: string, params: unknown[] = []): boolean {
        try {
            return Boolean(this.db.prepare(query).get(...params));
        } catch {
            return false;
        }
    }

    private quoteSqlString(value: string): string {
        return `'${value.replaceAll("'", "''")}'`;
    }

    private applySqlMigration(name: string, contents: string): void {
        const statements = contents.split(/;\s*\n/);
        for (let i = 0; i < statements.length; i++) {
            const stmt = statements[i].trim();
            if (stmt === '') continue;
            try {
                this.db.exec(`${stmt};`);
            } catch (e) {
                throw new Error(
                    `[sqlite] failed to apply ${name} at statement ${i}`,
                    { cause: e },
                );
            }
        }
    }

    private async applyJsMigration(
        name: string,
        contents: string,
    ): Promise<void> {
        const wrapped = `(async () => {${contents}})()`;
        const ctx = createContext({
            read: this.read.bind(this),
            write: this.write.bind(this),
            log: console,
            console,
        });
        try {
            await runInContext(wrapped, ctx);
        } catch (e) {
            throw new Error(`[sqlite] failed to apply ${name}`, { cause: e });
        }
    }
}
