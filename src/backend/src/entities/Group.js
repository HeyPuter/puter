const SimpleEntity = require("../definitions/SimpleEntity");

module.exports = SimpleEntity({
    name: 'group',
    fetchers: {
        async members () {
            const svc_group = this.services.get('group');
            const members = await svc_group.list_members({ uid: this.values.uid });
            return members;
        }
    },
    methods: {
        async get_client_value () {
            await this.fetch_members();
            const group = {
                uid: this.values.uid,
                metadata: this.values.metadata,
                members: this.values.members,
            };
            return group;
        }
    }
});
