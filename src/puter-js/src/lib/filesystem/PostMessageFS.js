import putility from "@heyputer/putility";
import { TFilesystem } from "./definitions.js";

const example =     {
        "id": "f485f1ba-de07-422c-8c4b-c2da057d4a44",
        "uid": "f485f1ba-de07-422c-8c4b-c2da057d4a44",
        "is_dir": true,
        "immutable": true,
        "name": "Test",
    };

export class PostMessageFilesystem extends putility.AdvancedBase {
    constructor ({ rpc, messageTarget }) {
        super();
        this.rpc = rpc;
        this.messageTarget = messageTarget;
    }
    static IMPLEMENTS = {
        [TFilesystem]: {
            stat: async function (o) {
                return example;
            },
            readdir: async function (o) {
                const tp = new putility.libs.promise.TeePromise();
                const $callback = this.rpc.registerCallback((result) => {
                    tp.resolve(result);
                });
                // return [example];
                this.messageTarget.postMessage({
                    $: 'puter-fs',
                    $callback,
                    op: 'readdir',
                    args: o,
                }, '*');

                return await tp;
            }
        }
    }
}
