import { RecursiveRecord } from "./services/MeteringService/types";

type ConfigRecord = RecursiveRecord<any>;

export interface IConfig extends ConfigRecord {
    load_config: (o: ConfigRecord) => void;
    __set_config_object__: (
        object: ConfigRecord,
        options?: { replacePrototype?: boolean; useInitialPrototype?: boolean }
    ) => void;
}

declare const config: IConfig;

export = config;
