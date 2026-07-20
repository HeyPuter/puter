import * as utils from '../lib/utils.js';

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
class Email {
    /**
     * @class
     * @param {object} puter - The parent puter instance.
     */
    constructor(puter) {
        this.puter = puter;
        this.authToken = puter.authToken;
        this.APIOrigin = puter.APIOrigin;
        this.appID = puter.appID;
    }

    /**
     * Sets a new authentication token.
     *
     * @param {string} authToken - The new authentication token.
     * @returns {void}
     */
    setAuthToken(authToken) {
        this.authToken = authToken;
    }

    /**
     * Sets the API origin.
     *
     * @param {string} APIOrigin - The new API origin.
     * @returns {void}
     */
    setAPIOrigin(APIOrigin) {
        this.APIOrigin = APIOrigin;
    }

    send = utils.make_driver_method(
        ['to', 'subject', 'body'],
        'puter-email',
        undefined,
        'send',
        {
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
        },
    );
}

export default Email;
