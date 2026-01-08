export class Perms {
    constructor (context: { authToken?: string; APIOrigin: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    grantUser (username: string, permission: string): Promise<Record<string, unknown>>;
    grantGroup (groupUid: string, permission: string): Promise<Record<string, unknown>>;
    grantApp (appUid: string, permission: string): Promise<Record<string, unknown>>;
    grantAppAnyUser (appUid: string, permission: string): Promise<Record<string, unknown>>;
    grantOrigin (origin: string, permission: string): Promise<Record<string, unknown>>;

    revokeUser (username: string, permission: string): Promise<Record<string, unknown>>;
    revokeGroup (groupUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeApp (appUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeAppAnyUser (appUid: string, permission: string): Promise<Record<string, unknown>>;
    revokeOrigin (origin: string, permission: string): Promise<Record<string, unknown>>;

    createGroup (metadata?: Record<string, unknown>, extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
    addUsersToGroup (uid: string, usernames: string[]): Promise<Record<string, unknown>>;
    removeUsersFromGroup (uid: string, usernames: string[]): Promise<Record<string, unknown>>;
    listGroups (): Promise<Record<string, unknown>>;
}
