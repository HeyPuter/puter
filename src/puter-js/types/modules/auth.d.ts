import { RequestCallbacks } from "../shared";

export interface User {
    uuid: string;
    username: string;
    email_confirmed?: boolean | number;
    actual_free_storage?: number;
    app_name?: string;
    feature_flags?: Record<string, unknown>;
    hasDevAccountAccess?: boolean;
    is_temp?: boolean;
    last_activity_ts?: number;
    otp?: boolean;
    paid_storage?: number;
    referral_code?: string;
    requires_email_confirmation?: boolean | number;
    subscribed?: boolean;
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

export interface SignInResult {
    success: boolean;
    token: string;
    app_uid: string;
    username: string;
    error?: string;
    msg?: string;
}

export class Auth {
    signIn (options?: { attempt_temp_user_creation?: boolean }): Promise<SignInResult>;
    signOut (): void;
    isSignedIn (): boolean;
    getUser (options:? RequestCallbacks<User>): Promise<User>;
    whoami (): Promise<User>;
    getMonthlyUsage (): Promise<MonthlyUsage>;
    getDetailedAppUsage (appId: string): Promise<DetailedAppUsage>;
}
