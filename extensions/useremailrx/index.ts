import { extension } from '@heyputer/backend/src/extensions';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
    MAX_MESSAGE_BYTES,
    isPuterEmailAddress,
    isTempUser,
    puterEmailUsername,
    storeInboxMessage,
} from '@heyputer/backend/src/services/email/mailbox.js';

// copied form peer secrets checker
const COMPARE_KEY = randomBytes(32);
const secretsEqual = (a: string, b: string): boolean =>
    timingSafeEqual(
        createHmac('sha256', COMPARE_KEY).update(a).digest(),
        createHmac('sha256', COMPARE_KEY).update(b).digest(),
    );

const USER_EMAIL_CONFIG = (extension.config as Record<string, unknown>)
    .userEmail as { secret?: string; feedbackAddresses?: unknown } | undefined;

const INGRESS_SECRET = USER_EMAIL_CONFIG?.secret;

/**
 * Local parts that take complaint feedback rather than naming a mailbox. The
 * same names are reserved at signup, so no account can be handed them.
 */
const DEFAULT_FEEDBACK_ADDRESSES = ['fbl', 'abuse', 'postmaster'];
const FEEDBACK_ADDRESSES = new Set(
    (Array.isArray(USER_EMAIL_CONFIG?.feedbackAddresses)
        ? USER_EMAIL_CONFIG.feedbackAddresses
        : DEFAULT_FEEDBACK_ADDRESSES
    ).map((local) => String(local).toLowerCase()),
);

/**
 * Feedback is handed over whole, so it is read into memory; a complaint report
 * quotes one message and has no business near the mailbox ceiling.
 */
const MAX_FEEDBACK_BYTES = 5 * 1024 * 1024;

const isFeedbackAddress = (to: string): boolean =>
    isPuterEmailAddress(to) &&
    FEEDBACK_ADDRESSES.has(puterEmailUsername(to).toLowerCase());

const readBody = async (req: Request): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
};

if (!INGRESS_SECRET) {
    console.warn(
        '[useremailrx] config.userEmail.secret unset - email ingress disabled',
    );
} else {
    extension.post(
        '/email/ingress',
        {
            subdomain: 'api',
        },
        async (req, res) => {
            // Answer first, then deal with the body nobody read. Touching the
            // request before the response has flushed takes the response down
            // with the connection and the caller sees a reset with no status,
            // so this hangs off `finish` — and it has to be the event rather
            // than `res.end(cb)`, because the compression middleware replaces
            // `res.end` with an `(chunk, encoding)` signature that has no
            // callback parameter, so a callback lands in `chunk` and dies in
            // `Buffer.byteLength`.
            //
            // `drain` discards the rest of a body we were entitled to read and
            // leaves the connection reusable. `close` is for bodies we do not
            // want to read at all: an unauthenticated caller's, or one whose
            // declared length is missing or over the cap.
            const refuse = (status: number, how: 'drain' | 'close') => {
                res.once('finish', () =>
                    how === 'drain' ? req.resume() : req.destroy(),
                );
                res.status(status).end();
            };

            const presented = req.query.SECRET;
            if (
                typeof presented !== 'string' ||
                !secretsEqual(presented, INGRESS_SECRET)
            ) {
                // Nothing has authenticated this caller, so refuse to spend
                // bandwidth reading whatever they were uploading.
                refuse(403, 'close');
                return;
            }

            const size = Number(req.headers['content-length']);
            if (!Number.isInteger(size) || size <= 0) {
                refuse(411, 'close');
                return;
            }
            if (size > MAX_MESSAGE_BYTES) {
                refuse(413, 'close');
                return;
            }

            const stores = extension.import('store');
            const services = extension.import('service');

            const to = String(req.query.to ?? '');
            let content: Buffer | Request = req;
            if (isFeedbackAddress(to)) {
                if (size > MAX_FEEDBACK_BYTES) {
                    refuse(413, 'close');
                    return;
                }
                const raw = await readBody(req);
                const event = {
                    to,
                    from:
                        typeof req.query.from === 'string'
                            ? req.query.from
                            : null,
                    raw,
                    handled: false,
                };
                await extension
                    .import('client')
                    .event.emitAndWait('email.ingress.feedback', event, {});
                if (event.handled) {
                    res.end();
                    return;
                }
                // Nobody took it: route it like any other message.
                content = raw;
            }

            const user = await stores.user.getByUsername(
                puterEmailUsername(to),
            );
            if (!user) {
                refuse(404, 'drain');
                return;
            }

            if (isTempUser(user)) {
                if (content === req) req.resume();
                res.end();
                return;
            }

            await storeInboxMessage(services.fs, user, {
                subject: req.query.subject,
                content,
                size: Buffer.isBuffer(content) ? content.length : size,
            });

            const { SECRET: _secret, ..._loggableQuery } = req.query;
            // console.log('got email: ', puterUser, loggableQuery, size);
            res.end();
        },
    );
}
