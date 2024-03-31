import * as _path from 'path';
import * as _util from 'util';

type TemporeryNodeType = any;

export interface ISelector {
    describe (showDebug?: boolean): string;
    setPropertiesKnownBySelector (node: object): void;
}

export class NodePathSelector {
    public value: string;

    constructor (path: string) {
        this.value = path;
    }

    public describe (showDebug?: boolean): string {
        return this.value;
    }

    public setPropertiesKnownBySelector (node: TemporeryNodeType): void {
        node.path = this.value;
        node.name = _path.basename(this.value);
    }
}

export class NodeInternalUIDSelector {
    public value: string;

    constructor (uid: string) {
        this.value = uid;
    }

    public describe (showDebug?: boolean): string {
        return `[uid:${this.value}]`;
    }

    public setPropertiesKnownBySelector (node: TemporeryNodeType): void {
        node.uid = this.value;
    }
}

export class NodeInternalIDSelector {
    constructor (
        public service: string,
        public id: number,
        public debugInfo: any
    ) { }

    public describe (showDebug?: boolean): string {
        if ( showDebug ) {
            return `[db:${this.id}] (${
                _util.inspect(this.debugInfo)
            })`;
        }
        return `[db:${this.id}]`;
    }

    public setPropertiesKnownBySelector (node: TemporeryNodeType): void {
        if ( this.service === 'mysql' ) {
            node.id = this.id;
        }
    }
}
