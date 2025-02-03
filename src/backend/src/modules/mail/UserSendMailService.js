const BaseService = require("../../services/BaseService");

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
                        html: {
                            type: 'string',
                        },
                    },
                    result: { type: 'json' },
                },
            }
        });   
    }
    static IMPLEMENTS = {
        'puter-send-mail': {
            async send ({ to, subject, html }) {
                const actor = this.context.get('actor');
                const svc_email = this.services.get('email');
    
                if ( ! actor.type.user ) {
                    throw new Error('Only users can send email.');
                }
                const user = actor.type.user;
    
                const transporter = svc_email.get_transport_();
                const o = {
                    from: `${user.username}@${this.config.domain}`, // sender address
                    to, subject, html,
                };
                await transporter.sendMail(o);
            }
        }
    }
}

module.exports = {
    UserSendMailService,
};
