/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
* File Name   : bundler.js
* Created at  : 2020-05-27
* Updated at  : 2020-06-01
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

const path              = require("path");
const assert            = require("assert");
const readline          = require("readline");
const fs                = require("@jeefo/fs");
const string_format     = require("@jeefo/utils/string/format");
const AsyncEventEmitter = require("@jeefo/utils/async/event_emitter");

const error_msg = (arg_name, type) =>
    `[Invalid argument]: new JeefoModule(${arg_name}: ${type})`;

const error_str   = prop => error_msg(`config.${prop}`, "string");
const error_array = prop => error_msg(`config.${prop}`, "Array");

const is_array  = Array.isArray;
const is_object = v => typeof v === "object" && v !== null;
const is_string = v => typeof v === "string";

const suffixes = [".js", ".json", "/index.js", "/index.json"];

const cyan     = '\x1b[36m';
const green    = '\x1b[32m';
const reset    = '\x1b[0m';
const {stdout} = process;

/*
class JeefoModule {
    constructor (path) {
        this.path         = path;
        this.dependencies = [];

        return new Promise (async (resolve, reject) => {
            const stat = await fs.stat(path);


        });
    }
}
*/

const is_found = async (absolute_path, base_dir) =>
    absolute_path.startsWith(base_dir) && await fs.is_file(absolute_path);

const resolve_path = async (filepath, base_dir) => {
    if (await is_found(filepath, base_dir)) {
        return {
            root_dir      : base_dir,
            absolute_dir  : path.dirname(filepath),
            absolute_path : filepath,
            relative_path : path.relative(base_dir, filepath)
        };
    }
};

const resolve_relative_path = async (include_dirs, relative_path) => {
    for (const base_dir of include_dirs) {
        const absolute_path  = path.resolve(base_dir, relative_path);
        const resolved_paths = await resolve_path(absolute_path, base_dir);
        if (resolved_paths) { return resolved_paths; }

        for (const suffix of suffixes) {
            const extented_path  = `${absolute_path}${suffix}`;
            const resolved_paths = await resolve_path(
                extented_path, base_dir
            );
            if (resolved_paths) { return resolved_paths; }
        }
    }

    return null;
};

const find_by_pkg_name = filepath => {
    if (filepath.startsWith("node_modules/")) {
        filepath = filepath.slice("node_modules/".length);
    }
    return pkg_name => filepath.startsWith(pkg_name);
};

const resolve_node_package = async (node_modules, pkg_path) => {
    for (const {root_dir, packages} of node_modules) {
        const pgk = packages.find(find_by_pkg_name(pkg_path));
        if (! pgk) { continue; }

        const absolute_path  = path.resolve(root_dir, pkg_path);
        const resolved_paths = await resolve_path(absolute_path, root_dir);
        if (resolved_paths) { return resolved_paths; }

        for (const suffix of suffixes) {
            const extented_path  = `${absolute_path}${suffix}`;
            const resolved_paths = await resolve_path(
                extented_path, root_dir
            );
            if (resolved_paths) { return resolved_paths; }
        }
    }

    return null;
};

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

                this.name         = config.name;
                this.cache_dir    = path.resolve(config.cache_dir);
                this.db_path      = `${this.cache_dir}/db.json`;
                this.output_dir   = path.resolve(output_dir);
                this.include_dirs = _include_dirs;
                this.node_modules = _node_modules;

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

    async resolve_path (filepath) {
        if (filepath.startsWith(".")) {
            return await resolve_relative_path(this.include_dirs, filepath);
        } else if (! filepath.startsWith("node_modules/")) {
            filepath = `node_modules/${filepath}`;
        }

        return await resolve_node_package(this.node_modules, filepath);
    }

    async get_module (filepath) {
        const resolved_paths = await this.resolve_path(filepath);
        if (! resolved_paths) { return null; }

        const module = { paths : resolved_paths };
        const {
            absolute_path, relative_path
        } = resolved_paths;

        const db    = await this.load_db();
        const info  = db[relative_path] || {};
        const stats = await fs.stat(absolute_path);

        module.mtime = new Date(info.mtime);

        let is_updated = false;
        if (stats.mtime.getTime() !== module.mtime.getTime()) {
            is_updated = true;
        } else if (info.dependencies) {
            for (const dep of info.dependencies) {
                const dep_info = db[dep];
                const {absolute_path} = await this.resolve_path(dep);
                const dep_stats = await fs.stat(absolute_path);
                const dep_mtime = new Date(dep_info.mtime);
                if (dep_mtime.getTime() !== dep_stats.mtime.getTime()) {
                    is_updated = true;
                    break;
                }
            }
        }

        if (is_updated) {
            //console.log("Updated:", relative_path);
            module.mtime   = stats.mtime;
            module.content = await fs.readFile(absolute_path, "utf8");

            await this.emit("file_updated", module);
            await this.save_module(relative_path, module);
        } else {
            //console.log("Same:", relative_path);
            const filepath = path.join(this.cache_dir, relative_path);
            module.content = await fs.readFile(filepath, "utf8");
        }

        return module;
    }

    async save_module (relative_path, module) {
        // Save module
        const filepath = path.join(this.cache_dir, relative_path);
        const dirname  = path.dirname(filepath);
        await fs.ensure_dir(dirname);
        await fs.writeFile(filepath, module.content, "utf8");

        // Save db
        const db = await this.load_db();
        const module_info = { mtime : module.mtime.toISOString() };
        if (module.dependencies.length) {
            module_info.dependencies = module.dependencies;
        }
        db[relative_path] = module_info;

        await this.store_db();
    }

    async store_db () {
        await fs.save_json(this.db_path, this.db);
        clearTimeout(this.timeout_id);
        this.timeout_id = setTimeout(() => {
            this.db = null;
        }, 3000);
    }

    async bundle () {
        const db       = await this.load_db();
        const paths    = Object.keys(db).filter(path => path.endsWith(".js"));
        const contents = [];

        const header = string_format(
            `\r{0}Building {1}${this.name}{0}:{2}`, green, cyan, reset
        );
        let format = string_format(
            `${header} {0}{1}%{2}`, undefined, green, reset
        );
        let percent_msg = value => string_format(format, value);
        stdout.write(percent_msg(0));

        for (const [index, relative_path] of paths.entries()) {
            const module   = { path : relative_path };
            const filepath = path.join(this.cache_dir, relative_path);

            module.content = await fs.readFile(filepath, "utf8");
            this.emit("bundle", module);
            contents.push(module);

            const percent = Math.floor(((index + 1) / paths.length) * 100);
            stdout.write(percent_msg(percent));
        }

        let msg = string_format(`${header} {0}final step...{1}`, green, reset);
        stdout.write(msg);

        const result = {
            content : contents.map(c=>c.content).join("\n\n")
        };
        this.emit("before_write", result);

        await fs.ensure_dir(this.output_dir);
        await fs.writeFile(
            `${this.output_dir}/${this.name}`, result.content, "utf8"
        );

        // Check symbol: \u2713
        readline.clearLine(process.stdout);
        console.log(string_format(`${header} {0}✓{1}`, green, reset));
    }

    async clear () {
        const paths = Object.keys(await this.load_db());
        for (const relative_path of paths) {
            const filepath = path.join(this.cache_dir, relative_path);
            await fs.unlink(filepath);
        }
        await fs.unlink(this.db_path);
        await remove_empty_dirs(this.cache_dir);
    }
}

module.exports = JeefoBundler;
