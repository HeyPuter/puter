const putility = require("@heyputer/putility");
const BaseService = require("../../services/BaseService");
const { Judge0Client } = require("./Judge0Client");
const { Context } = require("../../util/context");
const { find_highest_version } = require("../../util/versionutil");
const APIError = require("../../api/APIError");

class Judge0Service extends BaseService {
    _construct () {
        this.about_ = {};
    }

    async _init () {
        this.languages = require('./languages/languages');
        this.client = new Judge0Client({
            token: this.config.token,
        });
        this.microcents_per_call =
            this.config.microcents_per_call ?? 50_000;

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
            if ( runtime.includes('-') ) {
                const versionIndex = runtime.lastIndexOf('-');
                const langPart =  runtime.slice(0, versionIndex);
                const versionPart = runtime.slice(versionIndex + 1);
                const lang = this.languages.find((lang) =>
                    lang.language === langPart && lang.version === versionPart
                );
                if ( lang ) {
                    return lang.judge0_id;
                }
            }
            const matchingLangs = this.languages.filter((lang) => lang.language === runtime);
            const lang = find_highest_version(matchingLangs);

            if ( lang ) {
                return lang.judge0_id;
            }
        })();

        if ( !lang_id ) {
            throw new Error(`Language or runtime not found: ${runtime}`);
        }

        {
            const svc_cost = this.services.get('cost')
            const usageAllowed = await svc_cost.get_funding_allowed({
                minimum: this.microcents_per_call,
            });
            if ( ! usageAllowed ) {
                throw APIError.create('insufficient_funds');
            }
            await svc_cost.record_cost({
                cost: this.microcents_per_call,
            });
        }

        const result = await this.client.create_submission({
            lang_id,
            code,
        });

        const submission_done = new putility.libs.promise.TeePromise();
        (async () => {
            // Need to poll the submission until it's done
            let i = 0;
            let poll_running = false;
            let poll = setInterval(async () => {
                // Prevent overlapping polls
                if ( poll_running ) return;
                
                // Custom backoff strategy
                let will_skip = false;
                if ( i > 5  && i % 2 === 0 ) will_skip = true;
                if ( i > 10 && i % 3 === 0 ) will_skip = true;
                if ( i > 50 && i % 5 === 0 ) will_skip = true;
                i++;
                if ( will_skip ) return;

                // Poll the submission
                poll_running = true;
                const submission = await this.client.get_submission(result.token);
                if ( submission.status.id >= 3 ) {
                    clearInterval(poll);
                    // this.submissions_[result.id] = submission;
                    submission_done.resolve(submission);
                }
                poll_running = false;
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
