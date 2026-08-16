import { PuterModule } from '../lib/PuterModule.js';
import * as utils from '../lib/utils.js';

/**
 * One attachment: either inline base64 `content`, or a Puter FS reference
 * (`path`/`uid`) read server-side with the caller's — falling back to the
 * authorizing worker's — file permissions.
 *
 * @typedef {Object} EmailAttachment
 * @property {string} [filename] Required with `content`; defaults to the file's name for FS refs.
 * @property {string} [content] Base64 file body. Mutually exclusive with `path`/`uid`.
 * @property {string} [path] Puter FS path (supports `~/`). Mutually exclusive with `content`.
 * @property {string} [uid] Puter FS entry uid. Mutually exclusive with `content`.
 * @property {string} [contentType] MIME type of the attachment.
 */

/**
 * The options form of `send()`.
 *
 * @typedef {Object} EmailSendOptions
 * @property {string | string[]} to Recipient address(es).
 * @property {string} subject
 * @property {string} [text] Plain-text body. At least one of `text` / `html` is required.
 * @property {string} [html] HTML body.
 * @property {string | string[]} [cc]
 * @property {string | string[]} [bcc]
 * @property {string} [replyTo]
 * @property {string} [emailAccessToken] A worker's auth token authorizing the send when the caller is
 * not itself a worker (inside a worker: `me.puter.authToken`). The caller stays the billed and
 * rate-limited identity.
 * @property {EmailAttachment[]} [attachments]
 */

/**
 * What one `send()` resolves to.
 *
 * @typedef {Object} EmailSendResult
 * @property {string | null} messageId First transport message id reported for this send, when available.
 * @property {number} cost Total charge for this send, in microcents.
 * @property {string[]} suppressed Recipients omitted because they opted out of this sender's mail.
 * @property {string[]} failed Recipients whose delivery attempt failed. Everyone else got their copy —
 * retry with just these addresses. A send where every delivery fails rejects instead.
 */

/**
 * Restricted outbound email (the `puter-email` driver interface).
 *
 * Every send must be authorized by a worker: either the worker calls
 * directly (`me.puter.email.send(...)`), or a user calls with their own
 * token and passes the worker's token as `emailAccessToken` — the caller is
 * the one billed and rate-limited. In a worker handler:
 *
 *   router.post('/notify', async ({ request, user }) => {
 *       const { to, subject, text } = await request.json();
 *       return await user.puter.email.send({
 *           to, subject, text,
 *           emailAccessToken: me.puter.authToken,
 *           // Inline or Puter-FS attachments:
 *           attachments: [
 *               { filename, content, contentType },  // content = base64
 *               { path: '~/Documents/report.pdf' },  // read server-side
 *           ],
 *       });
 *   });
 *
 * Positional form: `await puter.email.send(to, subject, body)`.
 *
 * Every mail automatically gets an unsubscribe / report-abuse footer.
 * Recipients who unsubscribe are dropped from future sends — they come
 * back in the result's `suppressed` array — and a send whose `to` list
 * is entirely unsubscribed is rejected.
 *
 * Each recipient gets a private delivery. A recipient whose delivery
 * fails comes back in the result's `failed` array (everyone else got
 * their copy — retry with just those addresses); the call only rejects
 * when no recipient could be delivered.
 */
export class EmailModule extends PuterModule {
    /**
     * Sends one email. The positional form is shorthand for a plain-text body;
     * everything else (html, cc/bcc, attachments, `emailAccessToken`) goes
     * through the options form.
     *
     * @type {{
     *   (to: string | string[], subject: string, body: string): Promise<EmailSendResult>,
     *   (options: EmailSendOptions): Promise<EmailSendResult>,
     * }}
     */
    send = utils.makeDriverMethod({
        iface: 'puter-email',
        method: 'send',
        argNames: ['to', 'subject', 'body'],
        preprocess: (args) => {
            // `body` is positional-call sugar for `text`.
            if (
                args.body !== undefined &&
                args.text === undefined &&
                args.html === undefined
            ) {
                args.text = args.body;
            }
            delete args.body;
            return args;
        },
    });
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../lib/types.js').OmitMembers<
 *     typeof EmailModule,
 *     'puter' | 'authToken'
 * >} EmailConstructor
 */

export const Email = /** @type {EmailConstructor} */ (EmailModule);

export default Email;
