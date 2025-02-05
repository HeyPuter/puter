const APIError = require("../../api/APIError");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const BaseService = require("../../services/BaseService");
const { Context } = require("../../util/context");
const validator = require('validator')

class UserSendMailService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('puter-send-mail', {
            description: 'Send an email.',
            methods: {
                send: {
                    description: 'Recognize text in an image or document.',
                    parameters: {
                        to: {
                            type: 'string',
                        },
                        subject: {
                            type: 'string',
                        },
                        body: {
                            type: 'string',
                        },
                        encoding: {
                            type: 'string',
                        },
                        attachments: {
                            type: 'json',
                        }
                    },
                    result: { type: 'json' },
                },
            }
        });   
    }
    static IMPLEMENTS = {
        'puter-send-mail': {
            async send ({
                to, subject, body,
                encoding,
                attachments = [],
            }) {
                const actor = Context.get('actor');
                const svc_email = this.services.get('email');
    
                if ( ! actor.type.user ) {
                    throw new Error('Only users can send email.');
                }
                const user = actor.type.user;

                encoding = encoding ?? 'html';
                if ( ! ['html', 'text'].includes(encoding) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'encoding',
                        expected: 'html or text',
                        got: encoding,
                    });
                }

                if ( ! validator.isEmail(to) ) {
                    throw APIError.create('field_invalid', null, {
                        key: 'to',
                        expected: 'a valid email address',
                        got: to,
                    });
                }

                // We're going to disallow subject lines over or including 998,
                // as nobody would ever do this unless they're trying to
                // exploit a faulty email client.
                if ( subject.length >= 998 ) {
                    throw APIError.create('field_too_long', null, {
                        key: 'subject',
                        max_length: 997,
                    });
                }
    
                const transporter = svc_email.get_transport_();
                const o = {
                    from: `${user.username}@${this.config.domain}`, // sender address
                    to,
                    subject,
                    [encoding === 'html' ? 'html' : 'text']: body,
                };
                
                for ( const attachment of attachments ) {
                    if ( attachment.path ) {
                        const svc_fs = this.services.get('filesystem');
                        const node = await svc_fs.node(attachment.path);
                        const ll_read = new LLRead();
                        const stream = await ll_read.run({
                            actor: Context.get('actor'),
                            fsNode: node,
                        });
                        attachment.content = stream;
                        delete attachment.path;
                    }
                }
                
                if ( attachments.length > 0 ) {
                    o.attachments = attachments;
                }
                
                await transporter.sendMail(o);
            }
        }
    }
}

module.exports = {
    UserSendMailService,
};
