import { getStoredToken, clearToken } from '../lib/config.js';
import * as ui from '../lib/ui.js';

export async function logoutCommand() {
  if (!getStoredToken()) {
    ui.info('No stored login to clear.');
    return;
  }
  clearToken();
  ui.success('Logged out.');
}
