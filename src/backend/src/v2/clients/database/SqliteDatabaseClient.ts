import { existsSync, readFileSync } from 'fs';
import { basename, extname, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';
import { DatabaseClient, type WriteResult } from './DatabaseClient';
import type { IConfig } from '../../types';

const __dirname_ = dirname(fileURLToPath(import.meta.url));

/**
 * Path to the migration files shipped with the v1 SQLite setup.
 * These live in the existing `services/database/sqlite_setup/` directory.
 */
const MIGRATIONS_DIR = resolve(__dirname_, '../../../services/database/sqlite_setup');

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

export class SqliteDatabaseClient extends DatabaseClient {

    override readonly engineName = 'sqlite';

    // better-sqlite3 instance — set during onServerStart
    private db!: InstanceType<typeof import('better-sqlite3')>;

    constructor (config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    override async onServerStart (): Promise<void> {
        const Database = (await import('better-sqlite3')).default;

        const dbPath = this.config.database?.path ?? ':memory:';
        const isNew = dbPath === ':memory:' || !existsSync(dbPath);

        this.db = new Database(dbPath);

        await this.runMigrations(isNew);
    }

    override onServerShutdown (): void {
        if ( this.db ) {
            this.db.close();
        }
    }

    // ------------------------------------------------------------------
    // Query interface
    // ------------------------------------------------------------------

    override async read (query: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
        query = this.transformQuery(query);
        params = this.transformParams(params);
        return this.db.prepare(query).all(...params) as Record<string, unknown>[];
    }

    override async pread (query: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
        // SQLite is single-node — pread is identical to read
        return this.read(query, params);
    }

    override async write (query: string, params: unknown[] = []): Promise<WriteResult> {
        query = this.transformQuery(query);
        params = this.transformParams(params);

        const info = this.db.prepare(query).run(...params);

        return {
            insertId: info.lastInsertRowid,
            anyRowsAffected: info.changes > 0,
        };
    }

    override async batchWrite (entries: { statement: string; values: unknown[] }[]): Promise<void> {
        this.db.transaction(() => {
            for ( let { statement, values } of entries ) {
                statement = this.transformQuery(statement);
                values = this.transformParams(values);
                this.db.prepare(statement).run(...values);
            }
        })();
    }

    // ------------------------------------------------------------------
    // SQLite-specific transforms
    // ------------------------------------------------------------------

    private transformQuery (query: string): string {
        return query.replace(/now\(\)/gi, "datetime('now')");
    }

    private transformParams (params: unknown[]): unknown[] {
        return params.map(p => {
            if ( typeof p === 'boolean' ) return p ? 1 : 0;
            return p;
        });
    }

    // ------------------------------------------------------------------
    // Migration system
    // ------------------------------------------------------------------

    private async runMigrations (isNew: boolean): Promise<void> {
        const highestVersion = AVAILABLE_MIGRATIONS[AVAILABLE_MIGRATIONS.length - 1][0] + 1;
        const targetVersion = this.config.database?.targetVersion ?? highestVersion;

        const userVersion = isNew
            ? -1
            : (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

        console.log(`[sqlite] database version: ${userVersion}`);

        const toApply: string[] = [];
        for ( const [threshold, files] of AVAILABLE_MIGRATIONS ) {
            if ( threshold + 1 >= targetVersion && targetVersion !== highestVersion ) {
                console.warn(`[sqlite] early exit: target version set to ${targetVersion}`);
                break;
            }
            if ( userVersion <= threshold ) {
                toApply.push(...files);
            }
        }

        if ( toApply.length === 0 ) return;

        console.log(`[sqlite] upgrading database: ${userVersion} -> ${targetVersion} (${toApply.length} migration files)`);

        for ( const file of toApply ) {
            const filePath = join(MIGRATIONS_DIR, file);
            const contents = readFileSync(filePath, 'utf8');
            const ext = extname(file);
            const name = basename(file);

            switch ( ext ) {
                case '.sql':
                    this.applySqlMigration(name, contents);
                    break;
                case '.js':
                    await this.applyJsMigration(name, contents);
                    break;
                default:
                    throw new Error(`[sqlite] unrecognised migration type: ${file}`);
            }
        }

        this.db.exec(`PRAGMA user_version = ${targetVersion};`);
        console.log(`[sqlite] database upgraded to version ${targetVersion}`);
    }

    private applySqlMigration (name: string, contents: string): void {
        const statements = contents.split(/;\s*\n/);
        for ( let i = 0; i < statements.length; i++ ) {
            const stmt = statements[i].trim();
            if ( stmt === '' ) continue;
            try {
                this.db.exec(`${stmt};`);
            } catch ( e ) {
                throw new Error(`[sqlite] failed to apply ${name} at statement ${i}`, { cause: e });
            }
        }
    }

    private async applyJsMigration (name: string, contents: string): Promise<void> {
        const wrapped = `(async () => {${contents}})()`;
        const ctx = createContext({
            read: this.read.bind(this),
            write: this.write.bind(this),
            log: console,
            console,
        });
        try {
            await runInContext(wrapped, ctx);
        } catch ( e ) {
            throw new Error(`[sqlite] failed to apply ${name}`, { cause: e });
        }
    }
}
