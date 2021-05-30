/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
* File Name   : module.js
* Created at  : 2021-05-29
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

const os     = require("os");
const fs     = require("@jeefo/fs");
const path   = require("path");
const assert = require("assert");

const suffixes        = [".js", ".json", "/index.js", "/index.json"];
const is_string       = v => typeof v === "string";
const REGEX_BACKSLASH = /\\/g;

const error_msg = (arg_name, type) =>
    `[Invalid argument]: new JeefoBundlerModule(${arg_name}: ${type})`;

const error_str = prop => error_msg(`${prop}`, "string");

const throw_not_found = filepath => {
    debugger
    const error = new Error(`Not found: '${filepath}'`);
    error.code = "ENOINT";
    throw error;
};

class JeefoBundlerModule {
    constructor (absolute_filepath, root_directory) {
        assert(is_string(absolute_filepath), error_str("absolute_filepath"));
        assert(is_string(root_directory), error_str("root_directory"));

        let relative_path = path.relative(root_directory, absolute_filepath);
        if (os.platform() === "win32") {
            relative_path = relative_path.replace(REGEX_BACKSLASH, '/');
        }

        this.path = {
            root_directory,

            local : {
                filepath  : absolute_filepath,
                directory : path.dirname(absolute_filepath),
            },
            remote : {
                filepath  : relative_path,
                directory : path.dirname(relative_path)
            }
        };
        this.dependencies = [];
    }

    async load_stat () {
        this.mtime = (await fs.stat(this.path.local.filepath)).mtime;
    }

    async load_content () {
        this.content = await fs.readFile(this.path.local.filepath, "utf8");
    }

    static async from_remote_filepath (filepath, include_directories) {
        for (const root_dir of include_directories) {
            const absolute_filepath = path.resolve(root_dir, filepath);
            if (await fs.is_file(absolute_filepath)) {
                return new JeefoBundlerModule(absolute_filepath, root_dir);
            }

            for (const suffix of suffixes) {
                const extented_filepath = `${absolute_filepath}${suffix}`;
                if (await fs.is_file(extented_filepath)) {
                    return new JeefoBundlerModule(extented_filepath, root_dir);
                }
            }
        }

        throw_not_found(filepath);
    }

    static async from_node_module (filepath, node_modules) {
        let pkg_path = filepath;
        if (filepath.startsWith("node_modules/")) {
            pkg_path = filepath.slice("node_modules/".length);
        } else {
            filepath = `node_modules/${filepath}`;
        }
        const find_by_pkg_name = p => pkg_path.startsWith(p);

        for (const {root_dir, packages} of node_modules) {
            if (! packages.find(find_by_pkg_name)) continue;

            const absolute_filepath = path.resolve(root_dir, filepath);
            if (await fs.is_file(absolute_filepath)) {
                return new JeefoBundlerModule(absolute_filepath, root_dir);
            }

            for (const suffix of suffixes) {
                const extented_filepath = `${absolute_filepath}${suffix}`;
                if (await fs.is_file(extented_filepath)) {
                    return new JeefoBundlerModule(extented_filepath, root_dir);
                }
            }
        }

        throw_not_found(filepath);
    }
}

module.exports = JeefoBundlerModule;
