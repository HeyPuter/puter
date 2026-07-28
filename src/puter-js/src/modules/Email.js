import { PuterModule } from '../lib/PuterModule.js';
import * as utils from '../lib/utils.js';

/** @typedef {import('../../types/modules/email').EmailSendOptions} EmailSendOptions */
/** @typedef {import('../../types/modules/email').EmailSendResult} EmailSendResult */

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
class Email extends PuterModule {
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

export default Email;
