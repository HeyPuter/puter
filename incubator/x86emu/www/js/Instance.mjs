import * as libv86 from '../third-party/libv86.js';
/**
 * Class representing an Instance of an emulator machine.
 */
class Instance {
	/**
	 * Create an Instance.
	 * @param {Object} options - Options for configuring the instance.
	 * @param {boolean} [options.term=true] - Terminal option.
	 * @param {boolean} [options.screen=false] - Screen option.
	 * @param {number} [options.memory=1024] - Memory size for the instance; must be power of two.
	 * @param {HTMLElement} [options.spawnRoot=undefined] - Html element where instance should be spawned.
	 * @param {boolean} [options.autoStart=true] - Whether to automatically start the instance.
	 * @param {string} [options.remote="./"] - Remote URL, defaults to origin.
	 * @param {string} [options.wsUrl=""] - Websocket URL option for communication with the outside world.
	 * @throws Will throw an error if remote URL does not end with a slash. @throws Will throw an error if the amount of memory provided is not a power of two.
	 */
	constructor(options) {
		const defaultOptions = {
			term: true,
			screen: false,
			memory: 1024,
			spawnRoot: undefined,
			autoStart: true,
			remote: "./",
			instanceName: [...Array(10)].map(() => Math.random().toString(36)[2]).join(''),
			wsUrl: "",
		};
		const instanceOptions = { ...defaultOptions, ...options };

		if (!instanceOptions.remote.endsWith('/'))
			throw new Error("Remote URL must end with a slash");
		if (typeof self !== 'undefined' && self.crypto) {
			this.instanceID = self.crypto.randomUUID();
		} else {
			this.instanceID = "Node";
		}
		this.terminals = [];
		let v86Options = {
			wasm_path: instanceOptions.remote + "third-party/v86.wasm",
			preserve_mac_from_state_image: true,
			memory_size: instanceOptions.memory * 1024 * 1024,
			vga_memory_size: 8 * 1024 * 1024,
			initial_state: { url: instanceOptions.remote + "static/image.bin" },
			filesystem: { baseurl: instanceOptions.remote + "static/9p-rootfs/" },
			autostart: instanceOptions.autoStart,
		};
		if (!(instanceOptions.wsUrl === ""))
			v86Options.network_relay_url = instanceOptions.wsUrl;
		if (!((Math.log(v86Options.memory_size) / Math.log(2)) % 1 === 0))
			throw new Error("Amount of memory provided isn't a power of two");
		if (instanceOptions.screen === true) {
			instanceOptions.spawnRoot.appendChild((() => {
				const div = document.createElement("div");
				div.setAttribute("id", instanceOptions.instanceName + '-screen');

				const child_div = document.createElement("div");
				child_div.setAttribute("style", "white-space: pre; font: 14px monospace; line-height: 14px");

				const canvas = document.createElement("canvas");
				canvas.setAttribute("style", "display: none");

				div.appendChild(child_div);
				div.appendChild(canvas);
				return div;
			})());
			v86Options.screen_container = document.getElementById(instanceOptions.instanceName + '-screen');
		}
		this.vm = new libv86.V86(v86Options);
	}
}

export default Instance
