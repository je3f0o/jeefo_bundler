/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
* File Name   : index.js
* Created at  : 2020-05-27
* Updated at  : 2021-05-31
* Author      : jeefo
* Purpose     :
* Description :
* Reference   :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
// ignore:start
"use strict";

/* globals*/
/* exported*/

// ignore:end

const path               = require("path");
const assert             = require("assert");
const readline           = require("readline");
const fs                 = require("@jeefo/fs");
const string_format      = require("@jeefo/utils/string/format");
const AsyncEventEmitter  = require("@jeefo/utils/async/event_emitter");
const {
    from_node_module,
    from_remote_filepath,
} = require("./module");

const error_msg = (arg_name, type) =>
    `[Invalid argument]: new JeefoBundler(${arg_name}: ${type})`;

const error_str   = prop => error_msg(`config.${prop}`, "string");
const error_array = prop => error_msg(`config.${prop}`, "Array");

const is_array  = Array.isArray;
const is_object = v => typeof v === "object" && v !== null;
const is_string = v => typeof v === "string";

const cyan     = '\x1b[36m';
const green    = '\x1b[32m';
const reset    = '\x1b[0m';
const {stdout} = process;

const remove_empty_dirs = async dirname => {
    let files = await fs.readdir(dirname);
    for (const filename of files) {
        const filepath = path.join(dirname, filename);
        if (await fs.is_directory(filepath)) {
            await remove_empty_dirs(filepath);
        }
    }
    files = await fs.readdir(dirname);
    if (! files.length) {
        await fs.rmdir(dirname);
    }
};

class JeefoBundler extends AsyncEventEmitter {
    constructor (config) {
        super(true);
        return new Promise (async (resolve, reject) => {
            try {
                assert(is_object(config), error_msg("config", "object"));
                assert(is_string(config.name), error_str("name"));
                assert(is_string(config.cache_dir), error_str("cache_dir"));
                assert(is_string(config.output_dir), error_str("output_dir"));

                const _include_dirs = [];
                const _node_modules = [];
                let {include_dirs, output_dir, node_modules} = config;

                if (include_dirs) {
                    assert(is_array(include_dirs), error_array("include_dirs"));
                    for (let dir of include_dirs) {
                        if (dir.startsWith("~/")) {
                            dir = `${process.env.HOME}/${dir.slice(2)}`;
                        }
                        dir = path.resolve(dir);

                        if (! await fs.is_directory(dir)) {
                            return reject(`'${dir}' is not a directory`);
                        }
                        _include_dirs.push(dir);
                    }
                }

                if (node_modules) {
                    for (let {root_dir, packages} of node_modules) {
                        if (root_dir.startsWith("~/")) {
                            root_dir = `${process.env.HOME}/${root_dir.slice(2)}`;
                        }
                        root_dir = path.resolve(root_dir);

                        _node_modules.push({
                            root_dir,
                            packages : packages.concat(),
                        });
                    }
                }

                if (output_dir.startsWith("~/")) {
                    output_dir = `${process.env.HOME}/${output_dir.slice(2)}`;
                }

                this.name                = config.name;
                this.cache_dir           = path.resolve(config.cache_dir);
                this.db_path             = `${this.cache_dir}/db.json`;
                this.output_dir          = path.resolve(output_dir);
                this.node_modules        = _node_modules;
                this.include_directories = _include_dirs;

                resolve(this);
            } catch (e) {
                reject(e);
            }
        });
    }

    async load_db () {
        if (! this.db) {
            if (await fs.is_file(this.db_path)) {
                this.db = await fs.load_json(this.db_path);
            } else {
                this.db = {};
            }
        }
        return this.db;
    }

    close_db () {
        clearTimeout(this.timeout_id);
        this.timeout_id = setTimeout(() => this.db = null, 3000);
    }

    async create_module (filepath) {
        const {include_directories, node_modules} = this;
        if (filepath.charAt(0) === '.') {
            return await from_remote_filepath(filepath, include_directories);
        }
        return await from_node_module(filepath, node_modules);
    }

    async is_updated (module) {
        const db         = await this.load_db();
        const {filepath} = module.path.remote;

        if (! db[filepath]) return true;

        const mtime = new Date(db[filepath].mtime);
        if (module.mtime.getTime() !== mtime.getTime()) return true;

        if (module.dependencies) {
            for (const dep of module.dependencies) {
                const paths = await this.resolve_path(dep);
                if (await this.is_updated(paths)) return true;
            }
        }
    }

    async get_module (filepath) {
        const module = await this.create_module(filepath);
        await module.load_stat();
        if (await this.is_updated(module)) {
            await module.load_content();

            await this.emit("file_updated", module);
            await this.save_module(module);
        } else {
            const {remote} = module.path;
            const filepath = path.join(this.cache_dir, remote.filepath);
            module.content = await fs.readFile(filepath, "utf8");
            this.close_db();
        }

        return module;
    }

    async save_module (module) {
        const {remote} = module.path;
        // Save module
        const filepath = path.join(this.cache_dir, remote.filepath);
        const dirname  = path.dirname(filepath);
        await fs.ensure_dir(dirname);
        await fs.writeFile(filepath, module.content, "utf8");

        // Save db
        const db = await this.load_db();
        const module_info = {mtime: module.mtime.toISOString()};
        if (module.dependencies.length) {
            module_info.dependencies = module.dependencies;
        }
        db[remote.filepath] = module_info;

        await fs.save_json(this.db_path, db);
        this.close_db();
    }

    async bundle () {
        const db       = await this.load_db();
        const js_paths = Object.keys(db).filter(path => path.endsWith(".js"));
        const contents = [];

        const header = string_format(
            `\r{0}Building {1}${this.name}{0}:{2}`, green, cyan, reset
        );
        let format = string_format(
            `${header} {0}{1}%{2}`, undefined, green, reset
        );
        let percent_msg = value => string_format(format, value);
        stdout.write(percent_msg(0));

        for (const [index, remote_filepath] of js_paths.entries()) {
            const module   = { path : remote_filepath };
            const filepath = path.join(this.cache_dir, remote_filepath);

            module.content = await fs.readFile(filepath, "utf8");
            this.emit("bundle", module);
            contents.push(module);

            const percent = Math.floor(((index + 1) / js_paths.length) * 100);
            stdout.write(percent_msg(percent));
        }

        let msg = string_format(`${header} {0}final step...{1}`, green, reset);
        stdout.write(msg);

        const result = {
            content : contents.map(c=>c.content).join("\n\n")
        };
        await this.emit("before_write", result);

        await fs.ensure_dir(this.output_dir);
        await fs.writeFile(
            `${this.output_dir}/${this.name}`, result.content, "utf8"
        );

        // Check symbol: \u2713
        readline.clearLine(process.stdout);
        console.log(string_format(`${header} {0}✓{1}`, green, reset));
    }

    async clear () {
        if (! await fs.exists(this.cache_dir)) return;

        const paths = Object.keys(await this.load_db());
        for (const remote_path of paths) {
            const filepath = path.join(this.cache_dir, remote_path);
            await fs.unlink(filepath);
        }
        await fs.unlink(this.db_path);
        await remove_empty_dirs(this.cache_dir);
        this.db = null;
    }
}

module.exports = JeefoBundler;

if (require.main === module) {
    (async function main () {
        const b = await new JeefoBundler({
            name         : "app.min.js",
            cache_dir    : `${process.cwd()}/.caches/app`,
            output_dir   : '',
            include_dirs : [process.cwd()],
            node_modules : [
                {
                    root_dir : '.',
                    packages : ["@jeefo"]
                },
            ],
        });

        const m = await b.get_module("./src/module");
        m;//console.log(m);
        await b.bundle();
    })().catch(e => console.error(e));
}
