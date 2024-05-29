import Spinner from "../UI/Components/Spinner";
import { Service } from "../definitions";

/**
 * This class exists to keep exports to the service script API separate
 * from the service where exports are registered. This will make it easier
 * to change how it works in the future.
 */
export class ExportRegistrantService extends Service {
    _init () {
        console.log(Spinner); // import gets optimized out if we don't do this
    }
}
