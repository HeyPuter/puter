const BaseService = require("../../services/BaseService");
const { Context } = require("../../util/context");

/**
 * ContextService provides a way for other services to register a hook to be
 * called when a context/subcontext is created.
 * 
 * Contexts are used to provide contextual information in the execution
 * context (dynamic scope). They can also be used to identify a "span";
 * a span is a labelled frame of execution that can be used to track
 * performance, errors, and other metrics.
 */
class ContextService extends BaseService {
    register_context_hook (event, hook) {
        Context.context_hooks_[event].push(hook);
    }
}

module.exports = {
    ContextService,
};
