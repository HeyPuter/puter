import crypto from 'node:crypto';

type AuthPayload = Record<string, unknown>;

const ALGO = 'aes-256-gcm';

export class AuthStateStore {
    #records = new Map<string, string>();
    #key: Buffer;

    constructor (secret = process.env.HAVAS_AGENTIC_OS_AUTH_SECRET || 'havas-agentic-os-demo-secret') {
        this.#key = crypto.createHash('sha256').update(secret).digest();
    }

    save (serverId: string, auth?: AuthPayload): string | undefined {
        if ( !auth || Object.keys(auth).length === 0 ) return undefined;
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv(ALGO, this.#key, iv);
        const encoded = Buffer.concat([
            cipher.update(JSON.stringify(auth), 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        const ref = `${serverId}:${Date.now().toString(36)}`;
        this.#records.set(ref, Buffer.concat([iv, tag, encoded]).toString('base64'));
        return ref;
    }

    load (ref?: string): AuthPayload | undefined {
        if ( ! ref ) return undefined;
        const raw = this.#records.get(ref);
        if ( ! raw ) return undefined;
        const payload = Buffer.from(raw, 'base64');
        const iv = payload.subarray(0, 12);
        const tag = payload.subarray(12, 28);
        const encrypted = payload.subarray(28);
        const decipher = crypto.createDecipheriv(ALGO, this.#key, iv);
        decipher.setAuthTag(tag);
        const json = Buffer.concat([
            decipher.update(encrypted),
            decipher.final(),
        ]).toString('utf8');
        return JSON.parse(json);
    }
}
