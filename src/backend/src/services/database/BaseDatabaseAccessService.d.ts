import { BaseService } from "../BaseService";

export type DBMode = "DB_WRITE" | "DB_READ";

export interface IBaseDatabaseAccessService {
    get(): this;
    read(query: string, params?: any[]): Promise<any>;
    tryHardRead(query: string, params?: any[]): Promise<any>;
    requireRead(query: string, params?: any[]): Promise<any>;
    pread(query: string, params?: any[]): Promise<any>;
    write(query: string, params?: any[]): Promise<any>;
    insert(table_name: string, data: Record<string, any>): Promise<any>;
    batch_write(statements: string[]): any;
}

export class BaseDatabaseAccessService extends BaseService implements IBaseDatabaseAccessService {
    static DB_WRITE: DBMode;
    static DB_READ: DBMode;
    case<T>(choices: Record<string, T>): T;
    get(): this;
    read(query: string, params?: any[]): Promise<any>;
    tryHardRead(query: string, params?: any[]): Promise<any>;
    requireRead(query: string, params?: any[]): Promise<any>;
    pread(query: string, params?: any[]): Promise<any>;
    write(query: string, params?: any[]): Promise<any>;
    insert(table_name: string, data: Record<string, any>): Promise<any>;
    batch_write(statements: string[]): any;
    _gen_insert_sql(table_name: string, data: Record<string, any>): string;
}
