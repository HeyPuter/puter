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
"use strict";

/**
 * Constructor for emulator instances.
 *
 * Usage: `var emulator = new V86(options);`
 *
 * Options can have the following properties (all optional, default in parenthesis):
 *
 * - `memory_size number` (16 * 1024 * 1024) - The memory size in bytes, should
 *   be a power of 2.
 * - `vga_memory_size number` (8 * 1024 * 1024) - VGA memory size in bytes.
 *
 * - `autostart boolean` (false) - If emulation should be started when emulator
 *   is ready.
 *
 * - `disable_keyboard boolean` (false) - If the keyboard should be disabled.
 * - `disable_mouse boolean` (false) - If the mouse should be disabled.
 *
 * - `network_relay_url string` (No network card) - The url of a server running
 *   websockproxy. See [networking.md](networking.md). Setting this will
 *   enable an emulated network card.
 *
 * - `bios Object` (No bios) - Either a url pointing to a bios or an
 *   ArrayBuffer, see below.
 * - `vga_bios Object` (No VGA bios) - VGA bios, see below.
 * - `hda Object` (No hard disk) - First hard disk, see below.
 * - `fda Object` (No floppy disk) - First floppy disk, see below.
 * - `cdrom Object` (No CD) - See below.
 *
 * - `bzimage Object` - A Linux kernel image to boot (only bzimage format), see below.
 * - `initrd Object` - A Linux ramdisk image, see below.
 * - `bzimage_initrd_from_filesystem boolean` - Automatically fetch bzimage and
 *    initrd from the specified `filesystem`.
 *
 * - `initial_state Object` (Normal boot) - An initial state to load, see
 *   [`restore_state`](#restore_statearraybuffer-state) and below.
 *
 * - `filesystem Object` (No 9p filesystem) - A 9p filesystem, see
 *   [filesystem.md](filesystem.md).
 *
 * - `serial_container HTMLTextAreaElement` (No serial terminal) - A textarea
 *   that will receive and send data to the emulated serial terminal.
 *   Alternatively the serial terminal can also be accessed programatically,
 *   see [serial.html](../examples/serial.html).
 *
 * - `screen_container HTMLElement` (No screen) - An HTMLElement. This should
 *   have a certain structure, see [basic.html](../examples/basic.html).
 *
 * ***
 *
 * There are two ways to load images (`bios`, `vga_bios`, `cdrom`, `hda`, ...):
 *
 * - Pass an object that has a url. Optionally, `async: true` and `size:
 *   size_in_bytes` can be added to the object, so that sectors of the image
 *   are loaded on demand instead of being loaded before boot (slower, but
 *   strongly recommended for big files). In that case, the `Range: bytes=...`
 *   header must be supported on the server.
 *
 *   ```javascript
 *   // download file before boot
 *   bios: {
 *       url: "bios/seabios.bin"
 *   }
 *   // download file sectors as requested, size is required
 *   hda: {
 *       url: "disk/linux.iso",
 *       async: true,
 *       size: 16 * 1024 * 1024
 *   }
 *   ```
 *
 * - Pass an `ArrayBuffer` or `File` object as `buffer` property.
 *
 *   ```javascript
 *   // use <input type=file>
 *   bios: {
 *       buffer: document.all.hd_image.files[0]
 *   }
 *   // start with empty hard disk
 *   hda: {
 *       buffer: new ArrayBuffer(16 * 1024 * 1024)
 *   }
 *   ```
 *
 * @param {{
      disable_mouse: (boolean|undefined),
      disable_keyboard: (boolean|undefined),
      wasm_fn: (Function|undefined),
    }} options
 * @constructor
 */
function V86(options)
{
    //var worker = new Worker("src/browser/worker.js");
    //var adapter_bus = this.bus = WorkerBus.init(worker);

    this.cpu_is_running = false;
    this.cpu_exception_hook = function(n) {};

    const bus = Bus.create();
    const adapter_bus = this.bus = bus[0];
    this.emulator_bus = bus[1];

    var cpu;
    var wasm_memory;

    const wasm_table = new WebAssembly.Table({ element: "anyfunc", initial: WASM_TABLE_SIZE + WASM_TABLE_OFFSET });

    const wasm_shared_funcs = {
        "cpu_exception_hook": n => this.cpu_exception_hook(n),
        "run_hardware_timers": function(a, t) { return cpu.run_hardware_timers(a, t); },
        "cpu_event_halt": () => { this.emulator_bus.send("cpu-event-halt"); },
        "abort": function() { dbg_assert(false); },
        "microtick": v86.microtick,
        "get_rand_int": function() { return v86util.get_rand_int(); },
        "apic_acknowledge_irq": function() { return cpu.devices.apic.acknowledge_irq(); },

        "io_port_read8": function(addr) { return cpu.io.port_read8(addr); },
        "io_port_read16": function(addr) { return cpu.io.port_read16(addr); },
        "io_port_read32": function(addr) { return cpu.io.port_read32(addr); },
        "io_port_write8": function(addr, value) { cpu.io.port_write8(addr, value); },
        "io_port_write16": function(addr, value) { cpu.io.port_write16(addr, value); },
        "io_port_write32": function(addr, value) { cpu.io.port_write32(addr, value); },

        "mmap_read8": function(addr) { return cpu.mmap_read8(addr); },
        "mmap_read16": function(addr) { return cpu.mmap_read16(addr); },
        "mmap_read32": function(addr) { return cpu.mmap_read32(addr); },
        "mmap_write8": function(addr, value) { cpu.mmap_write8(addr, value); },
        "mmap_write16": function(addr, value) { cpu.mmap_write16(addr, value); },
        "mmap_write32": function(addr, value) { cpu.mmap_write32(addr, value); },
        "mmap_write64": function(addr, value0, value1) { cpu.mmap_write64(addr, value0, value1); },
        "mmap_write128": function(addr, value0, value1, value2, value3) {
            cpu.mmap_write128(addr, value0, value1, value2, value3);
        },

        "log_from_wasm": function(offset, len) {
            const str = v86util.read_sized_string_from_mem(wasm_memory, offset, len);
            dbg_log(str, LOG_CPU);
        },
        "console_log_from_wasm": function(offset, len) {
            const str = v86util.read_sized_string_from_mem(wasm_memory, offset, len);
            console.error(str);
        },
        "dbg_trace_from_wasm": function() {
            dbg_trace(LOG_CPU);
        },

        "codegen_finalize": (wasm_table_index, start, state_flags, ptr, len) => {
            cpu.codegen_finalize(wasm_table_index, start, state_flags, ptr, len);
        },
        "jit_clear_func": (wasm_table_index) => cpu.jit_clear_func(wasm_table_index),
        "jit_clear_all_funcs": () => cpu.jit_clear_all_funcs(),

        "__indirect_function_table": wasm_table,
    };

    let wasm_fn = options.wasm_fn;

    if(!wasm_fn)
    {
        wasm_fn = env =>
        {
            return new Promise(resolve => {
                let v86_bin = DEBUG ? "v86-debug.wasm" : "v86.wasm";
                let v86_bin_fallback = "v86-fallback.wasm";

                if(options.wasm_path)
                {
                    v86_bin = options.wasm_path;
                    const slash = v86_bin.lastIndexOf("/");
                    const dir = slash === -1 ? "" : v86_bin.substr(0, slash);
                    v86_bin_fallback = dir + "/" + v86_bin_fallback;
                }
                else if(typeof window === "undefined" && typeof __dirname === "string")
                {
                    v86_bin = __dirname + "/" + v86_bin;
                    v86_bin_fallback = __dirname + "/" + v86_bin_fallback;
                }
                else
                {
                    v86_bin = "build/" + v86_bin;
                    v86_bin_fallback = "build/" + v86_bin_fallback;
                }

                v86util.load_file(v86_bin, {
                    done: async bytes =>
                    {
                        try
                        {
                            const { instance } = await WebAssembly.instantiate(bytes, env);
                            this.wasm_source = bytes;
                            resolve(instance.exports);
                        }
                        catch(err)
                        {
                            v86util.load_file(v86_bin_fallback, {
                                    done: async bytes => {
                                        const { instance } = await WebAssembly.instantiate(bytes, env);
                                        this.wasm_source = bytes;
                                        resolve(instance.exports);
                                    },
                                });
                        }
                    },
                    progress: e =>
                    {
                        this.emulator_bus.send("download-progress", {
                            file_index: 0,
                            file_count: 1,
                            file_name: v86_bin,

                            lengthComputable: e.lengthComputable,
                            total: e.total,
                            loaded: e.loaded,
                        });
                    }
                });
            });
        };
    }

    wasm_fn({ "env": wasm_shared_funcs })
        .then((exports) => {
            wasm_memory = exports.memory;
            exports["rust_init"]();

            const emulator = this.v86 = new v86(this.emulator_bus, { exports, wasm_table });
            cpu = emulator.cpu;

            this.continue_init(emulator, options);
        });

    this.zstd_worker = null;
    this.zstd_worker_request_id = 0;
}

V86.prototype.continue_init = async function(emulator, options)
{
    this.bus.register("emulator-stopped", function()
    {
        this.cpu_is_running = false;
    }, this);

    this.bus.register("emulator-started", function()
    {
        this.cpu_is_running = true;
    }, this);

    var settings = {};

    this.disk_images = {
        fda: undefined,
        fdb: undefined,
        hda: undefined,
        hdb: undefined,
        cdrom: undefined,
    };

    const boot_order =
        options.boot_order ? options.boot_order :
        options.fda ? BOOT_ORDER_FD_FIRST :
        options.hda ? BOOT_ORDER_HD_FIRST : BOOT_ORDER_CD_FIRST;

    settings.acpi = options.acpi;
    settings.disable_jit = options.disable_jit;
    settings.load_devices = true;
    settings.log_level = options.log_level;
    settings.memory_size = options.memory_size || 64 * 1024 * 1024;
    settings.vga_memory_size = options.vga_memory_size || 8 * 1024 * 1024;
    settings.boot_order = boot_order;
    settings.fastboot = options.fastboot || false;
    settings.fda = undefined;
    settings.fdb = undefined;
    settings.uart1 = options.uart1;
    settings.uart2 = options.uart2;
    settings.uart3 = options.uart3;
    settings.cmdline = options.cmdline;
    settings.preserve_mac_from_state_image = options.preserve_mac_from_state_image;
    settings.mac_address_translation = options.mac_address_translation;
    settings.cpuid_level = options.cpuid_level;
    settings.virtio_console = options.virtio_console;

    if(options.network_adapter)
    {
        this.network_adapter = options.network_adapter(this.bus);
    }
    else if(options.network_relay_url)
    {
        this.network_adapter = new NetworkAdapter(options.network_relay_url, this.bus);
    }

    // Enable unconditionally, so that state images don't miss hardware
    // TODO: Should be properly fixed in restore_state
    settings.enable_ne2k = true;

    if(!options.disable_keyboard)
    {
        this.keyboard_adapter = new KeyboardAdapter(this.bus);
    }
    if(!options.disable_mouse)
    {
        this.mouse_adapter = new MouseAdapter(this.bus, options.screen_container);
    }

    if(options.screen_container)
    {
        this.screen_adapter = new ScreenAdapter(options.screen_container, this.bus);
    }
    else if(options.screen_dummy)
    {
        this.screen_adapter = new DummyScreenAdapter(this.bus);
    }

    if(options.serial_container)
    {
        this.serial_adapter = new SerialAdapter(options.serial_container, this.bus);
        //this.recording_adapter = new SerialRecordingAdapter(this.bus);
    }

    if(options.serial_container_xtermjs)
    {
        this.serial_adapter = new SerialAdapterXtermJS(options.serial_container_xtermjs, this.bus);
    }

    if(!options.disable_speaker)
    {
        this.speaker_adapter = new SpeakerAdapter(this.bus);
    }

    // ugly, but required for closure compiler compilation
    function put_on_settings(name, buffer)
    {
        switch(name)
        {
            case "hda":
                settings.hda = this.disk_images.hda = buffer;
                break;
            case "hdb":
                settings.hdb = this.disk_images.hdb = buffer;
                break;
            case "cdrom":
                settings.cdrom = this.disk_images.cdrom = buffer;
                break;
            case "fda":
                settings.fda = this.disk_images.fda = buffer;
                break;
            case "fdb":
                settings.fdb = this.disk_images.fdb = buffer;
                break;

            case "multiboot":
                settings.multiboot = this.disk_images.multiboot = buffer.buffer;
                break;
            case "bzimage":
                settings.bzimage = this.disk_images.bzimage = buffer.buffer;
                break;
            case "initrd":
                settings.initrd = this.disk_images.initrd = buffer.buffer;
                break;

            case "bios":
                settings.bios = buffer.buffer;
                break;
            case "vga_bios":
                settings.vga_bios = buffer.buffer;
                break;
            case "initial_state":
                settings.initial_state = buffer.buffer;
                break;
            case "fs9p_json":
                settings.fs9p_json = buffer;
                break;
            default:
                dbg_assert(false, name);
        }
    }

    var files_to_load = [];

    const add_file = (name, file) =>
    {
        if(!file)
        {
            return;
        }

        if(file.get && file.set && file.load)
        {
            files_to_load.push({
                name: name,
                loadable: file,
            });
            return;
        }

        if(name === "bios" || name === "vga_bios" ||
            name === "initial_state" || name === "multiboot" ||
            name === "bzimage" || name === "initrd")
        {
            // Ignore async for these because they must be available before boot.
            // This should make result.buffer available after the object is loaded
            file.async = false;
        }

        if(file.url && !file.async)
        {
            files_to_load.push({
                name: name,
                url: file.url,
                size: file.size,
            });
        }
        else
        {
            files_to_load.push({
                name,
                loadable: v86util.buffer_from_object(file, this.zstd_decompress_worker.bind(this)),
            });
        }
    };

    if(options.state)
    {
        console.warn("Warning: Unknown option 'state'. Did you mean 'initial_state'?");
    }

    add_file("bios", options.bios);
    add_file("vga_bios", options.vga_bios);
    add_file("cdrom", options.cdrom);
    add_file("hda", options.hda);
    add_file("hdb", options.hdb);
    add_file("fda", options.fda);
    add_file("fdb", options.fdb);
    add_file("initial_state", options.initial_state);
    add_file("multiboot", options.multiboot);
    add_file("bzimage", options.bzimage);
    add_file("initrd", options.initrd);

    if(options.filesystem)
    {
        var fs_url = options.filesystem.basefs;
        var base_url = options.filesystem.baseurl;

        let file_storage = new MemoryFileStorage();

        if(base_url)
        {
            file_storage = new ServerFileStorageWrapper(file_storage, base_url);
        }
        settings.fs9p = this.fs9p = new FS(file_storage);

        if(fs_url)
        {
            dbg_assert(base_url, "Filesystem: baseurl must be specified");

            var size;

            if(typeof fs_url === "object")
            {
                size = fs_url.size;
                fs_url = fs_url.url;
            }
            dbg_assert(typeof fs_url === "string");

            files_to_load.push({
                name: "fs9p_json",
                url: fs_url,
                size: size,
                as_json: true,
            });
        }
    }

    var starter = this;
    var total = files_to_load.length;

    var cont = function(index)
    {
        if(index === total)
        {
            setTimeout(done.bind(this), 0);
            return;
        }

        var f = files_to_load[index];

        if(f.loadable)
        {
            f.loadable.onload = function(e)
            {
                put_on_settings.call(this, f.name, f.loadable);
                cont(index + 1);
            }.bind(this);
            f.loadable.load();
        }
        else
        {
            v86util.load_file(f.url, {
                done: function(result)
                {
                    if(f.url.endsWith(".zst") && f.name !== "initial_state")
                    {
                        dbg_assert(f.size, "A size must be provided for compressed images");
                        result = this.zstd_decompress(f.size, new Uint8Array(result));
                    }

                    put_on_settings.call(this, f.name, f.as_json ? result : new v86util.SyncBuffer(result));
                    cont(index + 1);
                }.bind(this),
                progress: function progress(e)
                {
                    if(e.target.status === 200)
                    {
                        starter.emulator_bus.send("download-progress", {
                            file_index: index,
                            file_count: total,
                            file_name: f.url,

                            lengthComputable: e.lengthComputable,
                            total: e.total || f.size,
                            loaded: e.loaded,
                        });
                    }
                    else
                    {
                        starter.emulator_bus.send("download-error", {
                            file_index: index,
                            file_count: total,
                            file_name: f.url,
                            request: e.target,
                        });
                    }
                },
                as_json: f.as_json,
            });
        }
    }.bind(this);
    cont(0);

    async function done()
    {
        //if(settings.initial_state)
        //{
        //    // avoid large allocation now, memory will be restored later anyway
        //    settings.memory_size = 0;
        //}

        if(settings.fs9p && settings.fs9p_json)
        {
            if(!settings.initial_state)
            {
                settings.fs9p.load_from_json(settings.fs9p_json);
            }
            else
            {
                dbg_log("Filesystem basefs ignored: Overridden by state image");
            }

            if(options.bzimage_initrd_from_filesystem)
            {
                const { bzimage_path, initrd_path } = this.get_bzimage_initrd_from_filesystem(settings.fs9p);

                dbg_log("Found bzimage: " + bzimage_path + " and initrd: " + initrd_path);

                const [initrd, bzimage] = await Promise.all([
                    settings.fs9p.read_file(initrd_path),
                    settings.fs9p.read_file(bzimage_path),
                ]);
                put_on_settings.call(this, "initrd", new v86util.SyncBuffer(initrd.buffer));
                put_on_settings.call(this, "bzimage", new v86util.SyncBuffer(bzimage.buffer));
                finish.call(this);
            }
            else
            {
                finish.call(this);
            }
        }
        else
        {
            dbg_assert(
                !options.bzimage_initrd_from_filesystem,
                "bzimage_initrd_from_filesystem: Requires a filesystem");
            finish.call(this);
        }

        function finish()
        {
            this.serial_adapter && this.serial_adapter.show && this.serial_adapter.show();

            this.bus.send("cpu-init", settings);

            if(settings.initial_state)
            {
                emulator.restore_state(settings.initial_state);

                // The GC can't free settings, since it is referenced from
                // several closures. This isn't needed anymore, so we delete it
                // here
                settings.initial_state = undefined;
            }

            if(options.autostart)
            {
                this.bus.send("cpu-run");
            }

            this.emulator_bus.send("emulator-loaded");
        }
    }
};

/**
 * @param {number} decompressed_size
 * @param {Uint8Array} src
 * @return {ArrayBuffer}
 */
V86.prototype.zstd_decompress = function(decompressed_size, src)
{
    const cpu = this.v86.cpu;

    dbg_assert(!this.zstd_context);
    this.zstd_context = cpu.zstd_create_ctx(src.length);

    new Uint8Array(cpu.wasm_memory.buffer).set(src, cpu.zstd_get_src_ptr(this.zstd_context));

    const ptr = cpu.zstd_read(this.zstd_context, decompressed_size);
    const result = cpu.wasm_memory.buffer.slice(ptr, ptr + decompressed_size);
    cpu.zstd_read_free(ptr, decompressed_size);

    cpu.zstd_free_ctx(this.zstd_context);
    this.zstd_context = null;

    return result;
};

/**
 * @param {number} decompressed_size
 * @param {Uint8Array} src
 * @return {Promise<ArrayBuffer>}
 */
V86.prototype.zstd_decompress_worker = async function(decompressed_size, src)
{
    if(!this.zstd_worker)
    {
        function the_worker()
        {
            let wasm;

            globalThis.onmessage = function(e)
            {
                if(!wasm)
                {
                    const env = Object.fromEntries([
                        "cpu_exception_hook", "run_hardware_timers",
                        "cpu_event_halt", "microtick", "get_rand_int",
                        "apic_acknowledge_irq",
                        "io_port_read8", "io_port_read16", "io_port_read32",
                        "io_port_write8", "io_port_write16", "io_port_write32",
                        "mmap_read8", "mmap_read16", "mmap_read32",
                        "mmap_write8", "mmap_write16", "mmap_write32", "mmap_write64", "mmap_write128",
                        "codegen_finalize",
                        "jit_clear_func", "jit_clear_all_funcs",
                    ].map(f => [f, () => console.error("zstd worker unexpectedly called " + f)]));

                    env["__indirect_function_table"] = new WebAssembly.Table({ element: "anyfunc", initial: 1024 });
                    env["abort"] = () => { throw new Error("zstd worker aborted"); };
                    env["log_from_wasm"] = env["console_log_from_wasm"] = (off, len) => {
                        console.log(String.fromCharCode(...new Uint8Array(wasm.exports.memory.buffer, off, len)));
                    };
                    env["dbg_trace_from_wasm"] = () => console.trace();

                    wasm = new WebAssembly.Instance(new WebAssembly.Module(e.data), { "env": env });
                    return;
                }

                const { src, decompressed_size, id } = e.data;
                const exports = wasm.exports;

                const zstd_context = exports["zstd_create_ctx"](src.length);
                new Uint8Array(exports.memory.buffer).set(src, exports["zstd_get_src_ptr"](zstd_context));

                const ptr = exports["zstd_read"](zstd_context, decompressed_size);
                const result = exports.memory.buffer.slice(ptr, ptr + decompressed_size);
                exports["zstd_read_free"](ptr, decompressed_size);

                exports["zstd_free_ctx"](zstd_context);

                postMessage({ result, id }, [result]);
            };
        }

        const url = URL.createObjectURL(new Blob(["(" + the_worker.toString() + ")()"], { type: "text/javascript" }));
        this.zstd_worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.zstd_worker.postMessage(this.wasm_source, [this.wasm_source]);
    }

    return new Promise(resolve => {
        const id = this.zstd_worker_request_id++;
        const done = async e =>
        {
            if(e.data.id === id)
            {
                this.zstd_worker.removeEventListener("message", done);
                dbg_assert(decompressed_size === e.data.result.byteLength);
                resolve(e.data.result);
            }
        };
        this.zstd_worker.addEventListener("message", done);
        this.zstd_worker.postMessage({ src, decompressed_size, id }, [src.buffer]);
    });
};

V86.prototype.get_bzimage_initrd_from_filesystem = function(filesystem)
{
    const root = (filesystem.read_dir("/") || []).map(x => "/" + x);
    const boot = (filesystem.read_dir("/boot/") || []).map(x => "/boot/" + x);

    let initrd_path;
    let bzimage_path;

    for(let f of [].concat(root, boot))
    {
        const old = /old/i.test(f) || /fallback/i.test(f);
        const is_bzimage = /vmlinuz/i.test(f) || /bzimage/i.test(f);
        const is_initrd = /initrd/i.test(f) || /initramfs/i.test(f);

        if(is_bzimage && (!bzimage_path || !old))
        {
            bzimage_path = f;
        }

        if(is_initrd && (!initrd_path || !old))
        {
            initrd_path = f;
        }
    }

    if(!initrd_path || !bzimage_path)
    {
        console.log("Failed to find bzimage or initrd in filesystem. Files:");
        console.log(root.join(" "));
        console.log(boot.join(" "));
    }

    return { initrd_path, bzimage_path };
};

/**
 * Start emulation. Do nothing if emulator is running already. Can be
 * asynchronous.
 * @export
 */
V86.prototype.run = async function()
{
    this.bus.send("cpu-run");
};

/**
 * Stop emulation. Do nothing if emulator is not running. Can be asynchronous.
 * @export
 */
V86.prototype.stop = async function()
{
    if(!this.cpu_is_running)
    {
        return;
    }

    await new Promise(resolve => {
        const listener = () => {
            this.remove_listener("emulator-stopped", listener);
            resolve();
        };
        this.add_listener("emulator-stopped", listener);
        this.bus.send("cpu-stop");
    });
};

/**
 * @ignore
 * @export
 */
V86.prototype.destroy = async function()
{
    await this.stop();

    this.v86.destroy();
    this.keyboard_adapter && this.keyboard_adapter.destroy();
    this.network_adapter && this.network_adapter.destroy();
    this.mouse_adapter && this.mouse_adapter.destroy();
    this.screen_adapter && this.screen_adapter.destroy();
    this.serial_adapter && this.serial_adapter.destroy()
    this.speaker_adapter && this.speaker_adapter.destroy();
};

/**
 * Restart (force a reboot).
 * @export
 */
V86.prototype.restart = function()
{
    this.bus.send("cpu-restart");
};

/**
 * Add an event listener (the emulator is an event emitter). A list of events
 * can be found at [events.md](events.md).
 *
 * The callback function gets a single argument which depends on the event.
 *
 * @param {string} event Name of the event.
 * @param {function(*)} listener The callback function.
 * @export
 */
V86.prototype.add_listener = function(event, listener)
{
    this.bus.register(event, listener, this);
};

/**
 * Remove an event listener.
 *
 * @param {string} event
 * @param {function(*)} listener
 * @export
 */
V86.prototype.remove_listener = function(event, listener)
{
    this.bus.unregister(event, listener);
};

/**
 * Restore the emulator state from the given state, which must be an
 * ArrayBuffer returned by
 * [`save_state`](#save_statefunctionobject-arraybuffer-callback).
 *
 * Note that the state can only be restored correctly if this constructor has
 * been created with the same options as the original instance (e.g., same disk
 * images, memory size, etc.).
 *
 * Different versions of the emulator might use a different format for the
 * state buffer.
 *
 * @param {ArrayBuffer} state
 * @export
 */
V86.prototype.restore_state = async function(state)
{
    dbg_assert(arguments.length === 1);
    this.v86.restore_state(state);
};

/**
 * Asynchronously save the current state of the emulator.
 *
 * @return {Promise<ArrayBuffer>}
 * @export
 */
V86.prototype.save_state = async function()
{
    dbg_assert(arguments.length === 0);
    return this.v86.save_state();
};

/**
 * @return {number}
 * @ignore
 * @export
 */
V86.prototype.get_instruction_counter = function()
{
    if(this.v86)
    {
        return this.v86.cpu.instruction_counter[0] >>> 0;
    }
    else
    {
        // TODO: Should be handled using events
        return 0;
    }
};

/**
 * @return {boolean}
 * @export
 */
V86.prototype.is_running = function()
{
    return this.cpu_is_running;
};

/**
 * Set the image inserted in the floppy drive. Can be changed at runtime, as
 * when physically changing the floppy disk.
 * @export
 */
V86.prototype.set_fda = async function(file)
{
    if(file.url && !file.async)
    {
        v86util.load_file(file.url, {
            done: result =>
            {
                this.v86.cpu.devices.fdc.set_fda(new v86util.SyncBuffer(result));
            },
        });
    }
    else
    {
        const image = v86util.buffer_from_object(file, this.zstd_decompress_worker.bind(this));
        image.onload = () =>
        {
            this.v86.cpu.devices.fdc.set_fda(image);
        };
        await image.load();
    }
};

/**
 * Eject the floppy drive.
 * @export
 */
V86.prototype.eject_fda = function()
{
    this.v86.cpu.devices.fdc.eject_fda();
};

/**
 * Send a sequence of scan codes to the emulated PS2 controller. A list of
 * codes can be found at http://stanislavs.org/helppc/make_codes.html.
 * Do nothing if there is no keyboard controller.
 *
 * @param {Array.<number>} codes
 * @export
 */
V86.prototype.keyboard_send_scancodes = function(codes)
{
    for(var i = 0; i < codes.length; i++)
    {
        this.bus.send("keyboard-code", codes[i]);
    }
};

/**
 * Send translated keys
 * @ignore
 * @export
 */
V86.prototype.keyboard_send_keys = function(codes)
{
    for(var i = 0; i < codes.length; i++)
    {
        this.keyboard_adapter.simulate_press(codes[i]);
    }
};

/**
 * Send text
 * @ignore
 * @export
 */
V86.prototype.keyboard_send_text = function(string)
{
    for(var i = 0; i < string.length; i++)
    {
        this.keyboard_adapter.simulate_char(string[i]);
    }
};

/**
 * Download a screenshot.
 *
 * @ignore
 * @export
 */
V86.prototype.screen_make_screenshot = function()
{
    if(this.screen_adapter)
    {
        return this.screen_adapter.make_screenshot();
    }
    return null;
};

/**
 * Set the scaling level of the emulated screen.
 *
 * @param {number} sx
 * @param {number} sy
 *
 * @ignore
 * @export
 */
V86.prototype.screen_set_scale = function(sx, sy)
{
    if(this.screen_adapter)
    {
        this.screen_adapter.set_scale(sx, sy);
    }
};

/**
 * Go fullscreen.
 *
 * @ignore
 * @export
 */
V86.prototype.screen_go_fullscreen = function()
{
    if(!this.screen_adapter)
    {
        return;
    }

    var elem = document.getElementById("screen_container");

    if(!elem)
    {
        return;
    }

    // bracket notation because otherwise they get renamed by closure compiler
    var fn = elem["requestFullScreen"] ||
            elem["webkitRequestFullscreen"] ||
            elem["mozRequestFullScreen"] ||
            elem["msRequestFullScreen"];

    if(fn)
    {
        fn.call(elem);

        // This is necessary, because otherwise chromium keyboard doesn't work anymore.
        // Might (but doesn't seem to) break something else
        var focus_element = document.getElementsByClassName("phone_keyboard")[0];
        focus_element && focus_element.focus();
    }

    try {
        navigator.keyboard.lock();
    } catch(e) {}

    this.lock_mouse();
};

/**
 * Lock the mouse cursor: It becomes invisble and is not moved out of the
 * browser window.
 *
 * @ignore
 * @export
 */
V86.prototype.lock_mouse = function()
{
    var elem = document.body;

    var fn = elem["requestPointerLock"] ||
                elem["mozRequestPointerLock"] ||
                elem["webkitRequestPointerLock"];

    if(fn)
    {
        fn.call(elem);
    }
};

/**
 * Enable or disable sending mouse events to the emulated PS2 controller.
 *
 * @param {boolean} enabled
 */
V86.prototype.mouse_set_status = function(enabled)
{
    if(this.mouse_adapter)
    {
        this.mouse_adapter.emu_enabled = enabled;
    }
};

/**
 * Enable or disable sending keyboard events to the emulated PS2 controller.
 *
 * @param {boolean} enabled
 * @export
 */
V86.prototype.keyboard_set_status = function(enabled)
{
    if(this.keyboard_adapter)
    {
        this.keyboard_adapter.emu_enabled = enabled;
    }
};


/**
 * Send a string to the first emulated serial terminal.
 *
 * @param {string} data
 * @export
 */
V86.prototype.serial0_send = function(data)
{
    for(var i = 0; i < data.length; i++)
    {
        this.bus.send("serial0-input", data.charCodeAt(i));
    }
};

/**
 * Send bytes to a serial port (to be received by the emulated PC).
 *
 * @param {Uint8Array} data
 * @export
 */
V86.prototype.serial_send_bytes = function(serial, data)
{
    for(var i = 0; i < data.length; i++)
    {
        this.bus.send("serial" + serial + "-input", data[i]);
    }
};

/**
 * Set the modem status of a serial port.
 */
V86.prototype.serial_set_modem_status = function(serial, status)
{
    this.bus.send("serial" + serial + "-modem-status-input", status);
};

/**
 * Set the carrier detect status of a serial port.
 */
V86.prototype.serial_set_carrier_detect = function(serial, status)
{
    this.bus.send("serial" + serial + "-carrier-detect-input", status);
};

/**
 * Set the ring indicator status of a serial port.
 */
V86.prototype.serial_set_ring_indicator = function(serial, status)
{
    this.bus.send("serial" + serial + "-ring-indicator-input", status);
};

/**
 * Set the data set ready status of a serial port.
 */
V86.prototype.serial_set_data_set_ready = function(serial, status)
{
    this.bus.send("serial" + serial + "-data-set-ready-input", status);
};

/**
 * Set the clear to send status of a serial port.
 */
V86.prototype.serial_set_clear_to_send = function(serial, status)
{
    this.bus.send("serial" + serial + "-clear-to-send-input", status);
};

/**
 * Mount another filesystem to the current filesystem.
 * @param {string} path Path for the mount point
 * @param {string|undefined} baseurl
 * @param {string|undefined} basefs As a JSON string
 * @param {function(Object)=} callback
 * @export
 */
V86.prototype.mount_fs = async function(path, baseurl, basefs, callback)
{
    let file_storage = new MemoryFileStorage();

    if(baseurl)
    {
        file_storage = new ServerFileStorageWrapper(file_storage, baseurl);
    }
    const newfs = new FS(file_storage, this.fs9p.qidcounter);
    const mount = () =>
    {
        const idx = this.fs9p.Mount(path, newfs);
        if(!callback)
        {
            return;
        }
        if(idx === -ENOENT)
        {
            callback(new FileNotFoundError());
        }
        else if(idx === -EEXIST)
        {
            callback(new FileExistsError());
        }
        else if(idx < 0)
        {
            dbg_assert(false, "Unexpected error code: " + (-idx));
            callback(new Error("Failed to mount. Error number: " + (-idx)));
        }
        else
        {
            callback(null);
        }
    };
    if(baseurl)
    {
        dbg_assert(typeof basefs === "object", "Filesystem: basefs must be a JSON object");
        newfs.load_from_json(basefs, () => mount());
    }
    else
    {
        mount();
    }
};

/**
 * Write to a file in the 9p filesystem. Nothing happens if no filesystem has
 * been initialized.
 *
 * @param {string} file
 * @param {Uint8Array} data
 * @export
 */
V86.prototype.create_file = async function(file, data)
{
    dbg_assert(arguments.length === 2);
    var fs = this.fs9p;

    if(!fs)
    {
        return;
    }

    var parts = file.split("/");
    var filename = parts[parts.length - 1];

    var path_infos = fs.SearchPath(file);
    var parent_id = path_infos.parentid;
    var not_found = filename === "" || parent_id === -1;

    if(!not_found)
    {
        await fs.CreateBinaryFile(filename, parent_id, data);
    }
    else
    {
        return Promise.reject(new FileNotFoundError());
    }
};

/**
 * Read a file in the 9p filesystem. Nothing happens if no filesystem has been
 * initialized.
 *
 * @param {string} file
 * @export
 */
V86.prototype.read_file = async function(file)
{
    dbg_assert(arguments.length === 1);
    var fs = this.fs9p;

    if(!fs)
    {
        return;
    }

    const result = await fs.read_file(file);

    if(result)
    {
        return result;
    }
    else
    {
        return Promise.reject(new FileNotFoundError());
    }
};

V86.prototype.automatically = function(steps)
{
    const run = (steps) =>
    {
        const step = steps[0];

        if(!step)
        {
            return;
        }

        const remaining_steps = steps.slice(1);

        if(step.sleep)
        {
            setTimeout(() => run(remaining_steps), step.sleep * 1000);
            return;
        }

        if(step.vga_text)
        {
            const screen = this.screen_adapter.get_text_screen();

            for(let line of screen)
            {
                if(line.includes(step.vga_text))
                {
                    run(remaining_steps);
                    return;
                }
            }

            setTimeout(() => run(steps), 1000);
            return;
        }

        if(step.keyboard_send)
        {
            if(step.keyboard_send instanceof Array)
            {
                this.keyboard_send_scancodes(step.keyboard_send);
            }
            else
            {
                dbg_assert(typeof step.keyboard_send === "string");
                this.keyboard_send_text(step.keyboard_send);
            }

            run(remaining_steps);
            return;
        }

        if(step.call)
        {
            step.call();
            run(remaining_steps);
            return;
        }

        dbg_assert(false, step);
    };

    run(steps);

};

/**
 * Reads data from memory at specified offset.
 *
 * @param {number} offset
 * @param {number} length
 * @returns
 */
V86.prototype.read_memory = function(offset, length)
{
    return this.v86.cpu.read_blob(offset, length);
};

/**
 * Writes data to memory at specified offset.
 *
 * @param {Array.<number>|Uint8Array} blob
 * @param {number} offset
 */
V86.prototype.write_memory = function(blob, offset)
{
    this.v86.cpu.write_blob(blob, offset);
};

V86.prototype.set_serial_container_xtermjs = function(element)
{
    this.serial_adapter && this.serial_adapter.destroy && this.serial_adapter.destroy();
    this.serial_adapter = new SerialAdapterXtermJS(element, this.bus);
    this.serial_adapter.show();
};

/**
 * @ignore
 * @constructor
 *
 * @param {string=} message
 */
function FileExistsError(message)
{
    this.message = message || "File already exists";
}
FileExistsError.prototype = Error.prototype;

/**
 * @ignore
 * @constructor
 *
 * @param {string=} message
 */
function FileNotFoundError(message)
{
    this.message = message || "File not found";
}
FileNotFoundError.prototype = Error.prototype;

// Closure Compiler's way of exporting
if(typeof window !== "undefined")
{
    window["V86Starter"] = V86;
    window["V86"] = V86;
}
else if(typeof module !== "undefined" && typeof module.exports !== "undefined")
{
    module.exports["V86Starter"] = V86;
    module.exports["V86"] = V86;
}
else if(typeof importScripts === "function")
{
    // web worker
    self["V86Starter"] = V86;
    self["V86"] = V86;
}
