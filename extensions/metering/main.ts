import { UsageController } from './controllers/UsageController.js';
import './eventListeners/subscriptionEvents.js';

const meteringService = extension.import('service:meteringService');
const sqlClient = extension.import('service:database');

const cache = extension.import('data').cache;

const controller = new UsageController(meteringService, sqlClient);
controller.registerRoutes();
