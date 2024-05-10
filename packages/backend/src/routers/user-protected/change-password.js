module.exports = {
    route: '/change-password',
    methods: ['POST'],
    handler: async (req, res, next) => {
        res.send('this is a test response');
    }
};
