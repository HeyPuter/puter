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

import Instance from "./Instance.mjs"

/**
 * Class representing the basic interface for managing instances of emulated machines.
 */
class InstanceManager {
	/**
	 * Create an Instance Manager.
	 * @param {Object} [options] - Options for configuring the instance manager.
	 * @param {boolean} [options.screen=true] - Spawn screen option.
	 * @param {boolean} [options.term=false] - Spawn terminal option.
	 * @param {string} [options.instanceName="Host"] - Name of the instance.
	 * @param {number} [options.memory=1024] - Memory size for the instance; must be power of two.
	 * @param {HTMLElement} [options.spawnRoot=undefined] - Htlm element where instance should be spawned.
	 * @param {boolean} [options.autoStart=true] - Whether to automatically start the instance.
	 * @param {string} [options.remote="./"] - Remote URL, defaults to origin.
	 * @param {string} [options.wsUrl=""] - Websocket URL option.
	 */
	constructor(options) {
		const defaultOptions = {
			term: false,
			screen: false,
			instanceName: "Host",
			memory: 1024,
			spawnRoot: undefined,
			autoStart: true,
			remote: "./",
			wsUrl: "",
		};
		const instanceOptions = { ...defaultOptions, ...options };
		this.instances = {};
		this.instanceNames = [];
		this.curr_inst = 0;
		this.instanceNames.push(instanceOptions.instanceName);
		this.instances[instanceOptions.instanceName] = new Instance(instanceOptions);
	}
	/**
	 * Create an instance with given options and adds it to the pool of instances.
	 * @param {Object} options - Options for configuring the instance.
	 * @returns {Promise<Object>} - Resolves with the initialized instance.
	 */
	async createInstance(options) {
		const instance = new Instance(options);
		this.instanceNames.push(instance.instanceName);
		this.instances[instance.instanceName] = instance;
		return instance;
	}
	/**
	 * Continue running a suspended instance.
	 * @param {string} instName - instName of the instance to continue.
	 */
	async continueInstance(instName) {
		var instance = await this.getInstanceByinstName(instName);
		if (!instance.vm.cpu_is_running)
			await instance.vm.run();
	}
	/**
	 * Suspend a running instance.
	 * @param {string} instName - instName of the instance to suspend.
	 */
	async suspendInstance(instName) {
		var instance = await this.getInstanceByinstName(instName);
		if (instance.vm.cpu_is_running)
			await instance.vm.stop();
	}
	/**
	 * Save the state of a running instance.
	 * @param {string} instName - instName of the instance to save state.
	 * @returns {Promise} - Promise resolving once state is saved.
	 */
	async saveState(instName) {
		const instance = this.getInstanceByinstName(instName);
		if (instance.vm.cpu_is_running)
			return instance.vm.save_state();
	}
	/**
	 * Load the state of a previously saved instance.
	 * @param {string} instName - instName of the instance to load state.
	 * @param {any} state - State to load.
	 * @returns {Promise} - Promise resolving once state is loaded.
	 */
	async loadState(instName, state) {
		const instance = this.getInstanceByinstName(instName);
		if (instance.vm.cpu_is_running)
			await instance.vm.save_state(state);
	}
	/**
	 * Connect two instances for communication through NIC's.
	 * @param {string} destinationinstName - instName of the destination instance.
	 * @param {string} sourceinstName - instName of the source instance.
	 */
	async connectInstances(destinationinstName, sourceinstName) {
		const destinationInstance = this.getInstanceByinstName(destinationinstName);
		const sourceInstance = this.getInstanceByinstName(sourceinstName);
		destinationInstance.add_listener("net0-send", (data) => {
			source.bus.send("net0-receive", data);
		});
		sourceInstance.add_listener("net0-send", (data) => {
			destination.bus.send("net0-receive", data);
		});
	}
	/**
	 * Execute a command within an instance.
	 * @param {Object} inst - Instance object.
	 * @param {string} cmd - Command to execute.
	 * @param {Object} env - Environment variables.
	 * @param {number} [timeout=60] - Timeout for the command execution.
	 */
	async exec(inst, cmd, env, timeout = 60) {
		// TODO: instNamed pipes on the instance would make this super nice so multiple terminals can be had
	}
	/**
	 * Destroy a specific instance.
	 * @param {string} instName - instName of the instance to destroy.
	 */
	async destroyInstance(instName) {
		await this.getInstanceByinstName(instName).destroy();
	}
	/**
	 * Destroy all instances.
	 */
	async destroyInstances() {
		for (const instance in this.instances)
			destroyInstance(instance)
	}
	/**
	 * Get an instance by its instName.
	 * @param {string} instName - instName of the instance.
	 * @returns {Object} - The instance object.
	 * @throws Will throw an error if the instance instName is not found.
	 */
	async getInstanceByinstName(instName) {
		if (!(instName in this.instances))
			throw Error("getInstance: instName not found in instances object");
		return this.instances[instName];
	}
}

export default InstanceManager
