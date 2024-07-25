class PolicyEnforcer {
    constructor (context) {
        this.context = context;
    }
    
    async check () {}
    async on_success () {}
    async on_fail () {}
}

module.exports = { PolicyEnforcer };
