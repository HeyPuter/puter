export interface AuthUser {
    uuid: string;
    username: string;
    email_confirmed?: boolean;
    [key: string]: unknown;
}

export interface AllowanceInfo {
    monthUsageAllowance: number;
    remaining: number;
}

export interface AppUsage {
    count: number;
    total: number;
}

export interface APIUsage {
    cost: number;
    count: number;
    units: number;
}

export interface MonthlyUsage {
    allowanceInfo: AllowanceInfo;
    appTotals: Record<string, AppUsage>;
    usage: Record<string, APIUsage>;
}

export interface DetailedAppUsage {
    total: number;
    [key: string]: APIUsage;
}

export class Auth {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    signIn (options?: { attempt_temp_user_creation?: boolean }): Promise<AuthUser | { token?: string }>;
    signOut (): void;
    isSignedIn (): boolean;
    getUser (): Promise<AuthUser>;
    whoami (): Promise<AuthUser>;
    getMonthlyUsage (): Promise<MonthlyUsage>;
    getDetailedAppUsage (appId: string): Promise<DetailedAppUsage>;
}
