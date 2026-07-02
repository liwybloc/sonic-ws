import { copyFileSync, cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const project = import.meta.dirname;
const repository = resolve(project, "../..");

copyFileSync(resolve(repository, "README.md"), resolve(project, "README.md"));
copyFileSync(resolve(repository, "LICENSE"), resolve(project, "LICENSE"));
mkdirSync(resolve(project, "bundled"), { recursive: true });
cpSync(resolve(repository, "bundled"), resolve(project, "bundled"), {
    recursive: true,
    force: true,
});
