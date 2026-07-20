/**
 * One attachment: either inline base64 `content`, or a Puter FS reference
 * (`path`/`uid`) read server-side with the caller's — falling back to the
 * authorizing worker's — file permissions.
 */
export interface EmailAttachment {
    /** Required with `content`; defaults to the file's name for FS refs. */
    filename?: string;
    /** Base64 file body. Mutually exclusive with `path`/`uid`. */
    content?: string;
    /** Puter FS path (supports `~/`). Mutually exclusive with `content`. */
    path?: string;
    /** Puter FS entry uid. Mutually exclusive with `content`. */
    uid?: string;
    contentType?: string;
}

export interface EmailSendOptions {
    /** Recipient address(es). */
    to: string | string[];
    subject: string;
    /** Plain-text body. At least one of `text` / `html` is required. */
    text?: string;
    /** HTML body. */
    html?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    /**
     * A worker's auth token authorizing the send when the caller is not
     * itself a worker (inside a worker: `me.puter.authToken`). The caller
     * stays the billed and rate-limited identity.
     */
    emailAccessToken?: string;
    attachments?: EmailAttachment[];
}

export interface EmailSendResult {
    /** First transport message id reported for this send, when available. */
    messageId: string | null;
    /** Total charge for this send, in microcents. */
    cost: number;
    /** Recipients omitted because they opted out of this sender's mail. */
    suppressed: string[];
    /**
     * Recipients whose delivery attempt failed. Everyone else got their
     * copy — retry with just these addresses. A send where every delivery
     * fails rejects instead.
     */
    failed: string[];
}

/**
 * Restricted outbound email. Sending is limited server-side to trusted
 * callers (Puter workers owned by allowlisted or permitted users).
 */
export class Email {
    /** Sends an email with a plain-text body. */
    send (to: string | string[], subject: string, body: string): Promise<EmailSendResult>;
    send (options: EmailSendOptions): Promise<EmailSendResult>;
}
