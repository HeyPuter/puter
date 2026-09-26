import { extension } from '@heyputer/backend/src/extensions';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
    MAX_MESSAGE_BYTES,
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

const INGRESS_SECRET = (
    (extension.config as Record<string, unknown>).userEmail as
        | { secret?: string }
        | undefined
)?.secret;

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

            const user = await stores.user.getByUsername(
                puterEmailUsername(req.query.to as string),
            );
            if (!user) {
                refuse(404, 'drain');
                return;
            }

            if (isTempUser(user)) {
                req.resume();
                res.end();
                return;
            }

            await storeInboxMessage(services.fs, user, {
                subject: req.query.subject,
                content: req,
                size,
            });

            const { SECRET: _secret, ..._loggableQuery } = req.query;
            // console.log('got email: ', puterUser, loggableQuery, size);
            res.end();
        },
    );
}
