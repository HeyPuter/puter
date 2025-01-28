const putility = require("@heyputer/putility");
const BaseService = require("../../services/BaseService");
const { Judge0Client } = require("./Judge0Client");
const { Context } = require("../../util/context");

class Judge0Service extends BaseService {
    _construct () {
        this.about_ = {};
    }

    async _init () {
        this.languages = require('./languages/languages');
        this.client = new Judge0Client({
            token: this.config.token,
        });

        // this.submissions_ = {};
    }

    static IMPLEMENTS = {
        ['puter-exec']: {
            async about () {
                return this.about ?? (this.about = await this.client.about());
            },
            async supported () {
            },
            async exec ({ runtime, code }) {
                return await this.exec_({ runtime, code });
            }
        }
    }

    async exec_ ({ runtime, code }) {
        const lang_id = (() => {
            if ( runtime.startsWith('j0-') ) {
                return runtime.slice(3);
            }
            let lang = this.languages.find((lang) => lang.language === runtime);
            if ( lang ) {
                return lang.judge0_id;
            }
        })();

        if ( !lang_id ) {
            throw new Error(`Language or runtime not found: ${runtime}`);
        }

        const result = await this.client.create_submission({
            lang_id,
            code,
        });

        const submission_done = new putility.libs.promise.TeePromise();
        (async () => {
            // Need to poll the submission until it's done
            let poll = setInterval(async () => {
                const submission = await this.client.get_submission(result.token);
                if ( submission.status.id >= 3 ) {
                    clearInterval(poll);
                    // this.submissions_[result.id] = submission;
                    submission_done.resolve(submission);
                }
            });

            // Wait for the submission to be done
            const submission = await submission_done;

            this.log.noticeme('Submission done', submission);
            
            // Send event
            const svc_event = this.services.get('event');
            svc_event.emit('puter-exec.submission.done', {
                id: submission.token,
                actor: Context.get('actor'),
                output: submission.stdout,
                summary: submission.message,
                measures: {
                    time: submission.time,
                    memory: submission.memory,
                },
                aux_outputs: {
                    compile: submission.compile_output,
                },
            });
        })();

        return result;
    }
}

module.exports = Judge0Service;
