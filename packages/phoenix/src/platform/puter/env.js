export const CreateEnvProvider = ({ config }) => {
    return {
        getEnv: () => {
            return {
                USER: config['puter.auth.username'],
                HOME: '/' + config['puter.auth.username'],
                HOSTNAME: 'puter.com',
            }
        },

        get (k) {
            return this.getEnv()[k];
        }
    }
}
