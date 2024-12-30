const BaseService = require("../../services/BaseService");
const { DB_READ } = require("../../services/database/consts");

const N_MONTHS = 4;

class OldAppNameService extends BaseService {
    _init () {
        this.db = this.services.get('database').get(DB_READ, 'old-app-name');
    }

    async ['__on_boot.consolidation'] () {
        const svc_event = this.services.get('event');
        svc_event.on('app.rename', async (_, { app_uid, old_name }) => {
            this.log.noticeme('GOT EVENT', { app_uid, old_name });
            await this.db.write(
                'INSERT INTO `old_app_names` (`app_uid`, `name`) VALUES (?, ?)',
                [app_uid, old_name]
            );
        });
    }

    async check_app_name (name) {
        const rows = await this.db.read(
            'SELECT * FROM `old_app_names` WHERE `name` = ?',
            [name]
        );

        if ( rows.length === 0 ) return;

        // Check if the app has been renamed in the last N months
        const [row] = rows;
        const timestamp = row.timestamp instanceof Date ? row.timestamp : new Date(
            // Ensure timestamp ir processed as UTC
            row.timestamp.endsWith('Z') ? row.timestamp : row.timestamp + 'Z'
        );

        const age = Date.now() - timestamp.getTime();

        // const n_ms = 60 * 1000;
        const n_ms = N_MONTHS * 30 * 24 * 60 * 60 * 1000
        this.log.noticeme('AGE INFO', {
            input_time: row.timestamp,
            age,
            n_ms,
        });
        if ( age > n_ms ) {
            // Remove record
            await this.db.write(
                'DELETE FROM `old_app_names` WHERE `id` = ?',
                [row.id]
            );
            // Return undefined
            return;
        }

        return {
            id: row.id,
            app_uid: row.app_uid,
        };
    }

    async remove_name (id) {
        await this.db.write(
            'DELETE FROM `old_app_names` WHERE `id` = ?',
            [id]
        );
    }
}

module.exports = {
    OldAppNameService,
};
