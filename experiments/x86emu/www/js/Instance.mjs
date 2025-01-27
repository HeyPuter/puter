/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { V86 } from "./V86Wrapper.mjs";
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
			term: false,
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
			throw new Error("Instance ctor: Remote URL must end with a slash");
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
			throw new Error("Instance ctor: Amount of memory provided isn't a power of two");
		if (instanceOptions.screen === true) {
			if (instanceOptions.spawnRoot === undefined)
				throw new Error("Instance ctor: spawnRoot is undefined, cannot continue")
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
		this.vm = new V86(v86Options);
		if (instanceOptions.term === true) {
			if (instanceOptions.spawnRoot === undefined)
				throw new Error("Instance ctor: spawnRoot is undefined, cannot continue")
			var term = new Terminal({
				allowTransparency: true,
			});
			instanceOptions.spawnRoot.appendChild((() => {
				const div = document.createElement("div");
				div.setAttribute("id", instanceOptions.instanceName + '-terminal');
				return div;
			})());
			term.open(document.getElementById(instanceOptions.instanceName + '-terminal'));
			term.write("Now booting emu, please stand by ...");
			this.vm.add_listener("emulator-started", () => {
				// emulator.serial0_send("\nsh networking.sh > /dev/null 2>&1 &\n\n");
				// emulator.serial0_send("clear\n");
				term.write("Welcome to psl!");
				this.vm.serial0_send("\n");
			});
			this.vm.add_listener("serial0-output-byte", (byte) => {
				var chr = String.fromCharCode(byte);
				if (chr <= "~") {
					term.write(chr);
				}
			});
			term.onData(data => {
				this.vm.serial0_send(data);
			});
		}
	}
}

export default Instance
