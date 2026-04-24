import { getAppIconUrl } from '../../util/appIcon.js';
import { PuterService } from '../types.js';

/**
 * Hardcoded list of recommended apps shown on the desktop launch grid.
 * Resolved at call time against the apps table.
 */
const RECOMMENDED_APP_NAMES = [
    'app-center',
    'dev-center',
    'editor',
    'code',
    'camera',
    'music-player',
    'recorder',
    'memos',
    'word-processor',
    'spreadsheet',
    'presentation',
    'pdf-editor',
    'basketball-tap',
    'blockup',
    'pretty-tiles',
    'galaxy-troops',
    'blend-fruits',
    'traffic-tap-puzzle',
];

export class RecommendedAppsService extends PuterService {
    async getRecommendedApps(): Promise<Array<Record<string, unknown>>> {
        const apiBaseUrl = this.config.api_base_url as string | undefined;
        const results: Array<Record<string, unknown>> = [];
        for (const name of RECOMMENDED_APP_NAMES) {
            const app = await this.stores.app.getByName(name);
            if (app) results.push(toAppSummary(app, apiBaseUrl));
        }
        return results;
    }
}

function toAppSummary(
    app: Record<string, unknown>,
    apiBaseUrl: string | undefined,
): Record<string, unknown> {
    return {
        uuid: app.uid,
        name: app.name,
        title: app.title,
        icon: getAppIconUrl(app, { apiBaseUrl }) ?? app.icon ?? null,
        godmode: Boolean(app.godmode),
        maximize_on_start: Boolean(app.maximize_on_start),
        index_url: app.index_url,
    };
}
