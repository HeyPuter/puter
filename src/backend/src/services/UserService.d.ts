import type { BaseService } from './BaseService';
import type { IUser } from './User';

export interface IInsertResult {
    insertId: number;
}

export class UserService extends BaseService  {
    get_system_dir(): unknown;
    generate_default_fsentries(args: { user: IUser }): Promise<void>;
    updateUserMetadata(userId:string, updatedMetadata: Record<string, unknown>): Promise<void>;
}
