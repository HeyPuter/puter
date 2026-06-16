import { RequestCallbacks } from "../shared";

/** Puter user details, as returned by `getUser()`. */
export interface User {
    /** Unique identifier of the user. */
    uuid: string;
    /** The user's username. */
    username: string;
    /** Whether the user's email address has been confirmed. */
    email_confirmed?: boolean | number;
    /** The user's free storage. */
    actual_free_storage?: number;
    /** The current active app. */
    app_name?: string;
    feature_flags?: Record<string, unknown>;
    hasDevAccountAccess?: boolean;
    /** Whether the user's account is temporary. */
    is_temp?: boolean;
    /** The user's last active timestamp. */
    last_activity_ts?: number;
    otp?: boolean;
    /** The amount of paid storage. */
    paid_storage?: number;
    /** The user's referral code. */
    referral_code?: string;
    /** Whether the user's account needs email confirmation. */
    requires_email_confirmation?: boolean | number;
    /** Whether the user is subscribed. */
    subscribed?: boolean;
}

/** Information about the user's resource allowance and consumption. */
export interface AllowanceInfo {
    /** Total resource allowance for the month. */
    monthUsageAllowance: number;
    /** The remaining allowance that can be used. */
    remaining: number;
}

/** Total usage for a single application. */
export interface AppUsage {
    /** Number of Puter API calls for the application. */
    count: number;
    /** Total resources consumed by the application. */
    total: number;
}

/** Usage information for a single API. */
export interface APIUsage {
    /** Total resource consumed by this API. */
    cost: number;
    /** Number of times the API is called. */
    count: number;
    /** Units of measurement for the API (e.g. tokens for AI calls, bytes for FS operations). */
    units: number;
}

/**
 * The user's monthly resource usage in the Puter ecosystem.
 * Resources are measured in microcents (e.g. `$0.01` = `1,000,000`).
 */
export interface MonthlyUsage {
    /** The user's resource allowance and consumption. */
    allowanceInfo: AllowanceInfo;
    /** Total usage by application, keyed by application id. */
    appTotals: Record<string, AppUsage>;
    /** Usage information per API, keyed by API name. */
    usage: Record<string, APIUsage>;
}

/**
 * Detailed resource usage statistics for a specific application.
 * Resources are measured in microcents (e.g. `$0.01` = `1,000,000`).
 */
export interface DetailedAppUsage {
    /** The application's total resource consumption. */
    total: number;
    /** Usage information per API, keyed by API name. */
    [key: string]: APIUsage;
}

/** The result of a sign-in operation. */
export interface SignInResult {
    /** Whether the sign-in operation was successful. */
    success: boolean;
    /** The authentication token. */
    token: string;
    /** Unique identifier of the application. */
    app_uid: string;
    /** Username of the user who signed in. */
    username: string;
    /** Error message if the sign-in operation failed. */
    error?: string;
    /** Additional message about the sign-in operation. */
    msg?: string;
}

/**
 * Authenticate users with their Puter accounts. Most Puter methods handle
 * authentication automatically; these methods are only needed for custom
 * authentication flows.
 */
export class Auth {
    /**
     * Initiates the sign in process for the user, opening a popup window with the
     * appropriate authentication method. Must be triggered by a user action (such
     * as a click) because it opens a popup. Resolves once the user has signed in.
     *
     * Set `attempt_temp_user_creation` to `true` to have Puter automatically create
     * a temporary user, useful for onboarding without requiring sign-up.
     */
    signIn (options?: { attempt_temp_user_creation?: boolean }): Promise<SignInResult>;
    /** Signs the user out of the application. */
    signOut (): void;
    /** Returns `true` if the user is signed in, `false` otherwise. */
    isSignedIn (): boolean;
    /** Returns the user's basic information. */
    getUser (options?: RequestCallbacks<User>): Promise<User>;
    whoami (): Promise<User>;
    /** Gets the user's current monthly resource usage. Usage data is scoped to the calling app only. */
    getMonthlyUsage (): Promise<MonthlyUsage>;
    /**
     * Gets detailed resource usage statistics for an application by its `appId`.
     * Users can only see usage of applications they have accessed before, and
     * usage data is scoped to the calling app only.
     */
    getDetailedAppUsage (appId: string): Promise<DetailedAppUsage>;
}
