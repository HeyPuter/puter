import { Service } from "../definitions.js";
import i18n from "../i18n/i18n.js";

export class LocaleService extends Service {
    format_duration (seconds) {
        console.log('seconds?', typeof seconds, seconds);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        // Padding each value to ensure it always has two digits
        const paddedHours = hours.toString().padStart(2, '0');
        const paddedMinutes = minutes.toString().padStart(2, '0');
        const paddedSeconds = remainingSeconds.toString().padStart(2, '0');

        if (hours === 0 && minutes === 0) {
            return `${paddedSeconds} ${i18n('seconds')}`;
        }

        if (hours === 0) {
            return `${paddedMinutes}:${paddedSeconds}`;
        }

        return `${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
    }
}
