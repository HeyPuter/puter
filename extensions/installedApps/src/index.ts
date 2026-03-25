import { InstalledAppsController } from './controllers/InstalledAppsController.js';

const installedAppsController = new InstalledAppsController(extension.import('data').db);

installedAppsController.registerRoutes();