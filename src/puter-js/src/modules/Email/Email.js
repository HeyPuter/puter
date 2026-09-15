import { fetchUrl } from '../../lib/networkUtils.js';
import { PuterModule } from '../../lib/PuterModule.js';
import { promptIfUpgradeRequired } from '../../lib/upgradePrompt.js';
import * as utils from '../../lib/utils.js';
import { compose } from './ComposerLib.js';
import { get } from './get.js';
import { list } from './list.js';

/** @typedef {import('../../index.js').Puter} Puter */

/** @typedef {import('./types.js').EmailAttachment} EmailAttachment */

/**
 * The options form of `sendTransactional()`.
 *
 * @typedef {Object} EmailSendOptions
 * @property {string | string[]} to Recipient address(es).
 * @property {string} subject
 * @property {string} [text] Plain-text body. At least one of `text` / `html` is required.
 * @property {string} [html] HTML body.
 * @property {string | string[]} [cc]
 * @property {string | string[]} [bcc]
 * @property {string} [replyTo] Defaults to the confirmed account email of the app's owner.
 * @property {string} [emailAccessToken] A worker's auth token authorizing the send when the caller is
 * not itself a worker (inside a worker: `me.puter.authToken`). The caller stays the billed and
 * rate-limited identity.
 * @property {EmailAttachment[]} [attachments]
 */

/**
 * What one `sendTransactional()` resolves to.
 *
 * @typedef {Object} EmailSendResult
 * @property {string | null} messageId First transport message id reported for this send, when available.
 * @property {number} cost Total charge for this send, in microcents.
 * @property {string[]} suppressed Recipients omitted because they opted out of this app's mail.
 * @property {string[]} failed Recipients whose delivery attempt failed. Everyone else got their copy —
 * retry with just these addresses. A send where every delivery fails rejects instead.
 */

/**
 * The call shapes shared by `sendTransactional()` and its legacy alias.
 *
 * @typedef {{
 *   (to: string | string[], subject: string, body: string): Promise<EmailSendResult>,
 *   (options: EmailSendOptions): Promise<EmailSendResult>,
 * }} EmailSendMethod
 */

/**
 * `body` is positional-call sugar for `text`.
 *
 * @param {Record<string, unknown>} args
 * @returns {Record<string, unknown>}
 */
const preprocessSendArgs = (args) => {
    if (
        args.body !== undefined &&
        args.text === undefined &&
        args.html === undefined
    ) {
        args.text = args.body;
    }
    delete args.body;
    return args;
};

/**
 * Transactional email from your app (the `puter-transactional-email` driver
 * interface).
 *
 * Every send must be authorized by a worker: either the worker calls
 * directly (`me.puter.email.sendTransactional(...)`), or a user calls with
 * their own token and passes the worker's token as `emailAccessToken` — the
 * caller is the one billed and rate-limited. In a worker handler:
 *
 *   router.post('/notify', async ({ request, user }) => {
 *       const { to, subject, text } = await request.json();
 *       return await user.puter.email.sendTransactional({
 *           to, subject, text,
 *           emailAccessToken: me.puter.authToken,
 *           // Inline or Puter-FS attachments:
 *           attachments: [
 *               { filename, content, contentType },  // content = base64
 *               { path: '~/Documents/report.pdf' },  // streamed server-side
 *           ],
 *       });
 *   });
 *
 * Positional form: `await puter.email.sendTransactional(to, subject, body)`.
 *
 * Mail goes out from a Puter-controlled address, labelled with the app's
 * title. Every mail automatically gets an unsubscribe / report-abuse
 * footer. Unsubscribing is per app: a recipient who opts out stops hearing
 * from the app they opted out of, and still hears from the other apps the
 * same account runs. Opted-out recipients are dropped from that app's
 * future sends — they come back in the result's `suppressed` array — and a
 * send whose `to` list is entirely opted out is rejected.
 *
 * Each recipient gets a private delivery. A recipient whose delivery
 * fails comes back in the result's `failed` array (everyone else got
 * their copy — retry with just those addresses); the call only rejects
 * when no recipient could be delivered.
 *
 * `send()` is the previous name of this method and still works; it will be
 * removed once existing apps have moved to `sendTransactional()`.
 *
 * Reading is the other half: every account has a mailbox at
 * `{username}@puter.email`, stored as `message/rfc822` objects under the
 * user's `~/.mail`. `list()` pages through a folder newest first without
 * downloading anything, and `get()` fetches and parses one message. An app
 * needs the `fs:/{username}/.mail:read` permission to read its user's mail.
 */
export class EmailModule extends PuterModule {
    // The fields hold the unbound functions so they keep the full overloaded
    // types (`bind` erases overloads); the constructor rebinds them at runtime
    // so destructured calls (`const { list } = puter.email`) keep working.
    list = list;
    get = get;

    /** @param {Puter} puter */
    constructor (puter) {
        super(puter);

        const methods = /** @type {Record<string, (...args: unknown[]) => unknown>} */ (
            /** @type {unknown} */ (this)
        );
        for ( const name of ['list', 'get'] ) {
            methods[name] = methods[name].bind(this);
        }
    }

    /**
     * Sends one transactional email. The positional form is shorthand for a
     * plain-text body; everything else (html, cc/bcc, attachments,
     * `emailAccessToken`) goes through the options form.
     *
     * @type {EmailSendMethod}
     */
    sendTransactional = utils.makeDriverMethod({
        iface: 'puter-transactional-email',
        method: 'sendTransactional',
        argNames: ['to', 'subject', 'body'],
        preprocess: preprocessSendArgs,
        upgradePrompt: {
            method: 'puter.email.sendTransactional',
            subscriptionMessage: 'Sending email from an app requires a subscription.',
        },
    });

    /**
     * Sends a message from the user's own mailbox. Resolves with the response
     * body as the server sent it, error bodies included; a refusal that an
     * upgrade would clear also prompts the user.
     *
     * @param {Record<string, unknown>} options Message fields for the composer.
     * @returns {Promise<unknown>}
     */
    send = async (options) => {
        const req = await fetchUrl(`${this.APIOrigin}/email/send`, { method: "POST", includePuterAuth: true, body: new Blob([await compose(options)], { type: 'message/rfc822' }) });
        const result = await req.json();
        if ( ! req.ok ) {
            promptIfUpgradeRequired(
                result && typeof result === 'object' ? { ...result, status: req.status } : { status: req.status },
                {
                    method: 'puter.email.send',
                    subscriptionMessage: 'Sending email to addresses outside Puter requires a subscription.',
                },
            );
        }
        return result;
    }
}

/**
 * The public face of the module: derived from the class, with the internal
 * `puter` handle and the legacy `authToken` accessor omitted.
 *
 * @typedef {import('../../lib/types.js').OmitMembers<
 *     typeof EmailModule,
 *     'puter' | 'authToken'
 * >} EmailConstructor
 */

export const Email = /** @type {EmailConstructor} */ (EmailModule);

export default Email;
