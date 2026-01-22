import fs from 'fs';
import path from 'path';

const DIST_DIR = './dist';
const LICENSE = `/**
 * Copyright 2026 Lily (liwybloc)
 * Licensed under the Apache License, Version 2.0.
 */
`;

function getFiles(dir, exts) {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...getFiles(fullPath, exts));
        } else if (exts.some(e => entry.name.endsWith(e))) {
            files.push(fullPath);
        }
    }
    return files;
}

function stripCommentsJS(code) {
    let result = LICENSE;
    let i = 0;
    const len = code.length;
    let inString = null;
    let inTemplateExpr = false;
    let inRegex = false;

    while (i < len) {
        const c = code[i];
        const next = code[i + 1];

        if (!inString && !inRegex) {
            if (c === '/' && next === '/') {
                i += 2;
                while (i < len && code[i] !== '\n') i++;
                continue;
            }
            if (c === '/' && next === '*') {
                i += 2;
                while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
                i += 2;
                continue;
            }
        }

        if (inString) {
            if (c === '\\') {
                result += code.slice(i, i + 2);
                i += 2;
                continue;
            }
            if (c === inString && !inTemplateExpr) {
                inString = null;
            }
        } else if (c === '"' || c === "'" || c === '`') {
            inString = c;
        }

        result += c;
        i++;
    }

    return result;
}

function stripNonJSDocTS(code) {
    let result = LICENSE;
    let i = 0;
    const len = code.length;
    let inString = null;
    let inTemplateExpr = false;

    while (i < len) {
        const c = code[i];
        const next = code[i + 1];

        if (!inString) {
            if (c === '/' && next === '/') {
                i += 2;
                while (i < len && code[i] !== '\n') i++;
                continue;
            }
            if (c === '/' && next === '*') {
                const start = i;
                i += 2;
                let isJSDoc = code[i] === '*';
                while (i < len && !(code[i] === '*' && code[i + 1] === '/')) i++;
                i += 2;
                if (isJSDoc) {
                    result += code.slice(start, i);
                }
                continue;
            }
        }

        if (inString) {
            if (c === '\\') {
                result += code.slice(i, i + 2);
                i += 2;
                continue;
            }
            if (c === inString && !inTemplateExpr) {
                inString = null;
            }
        } else if (c === '"' || c === "'" || c === '`') {
            inString = c;
        }

        result += c;
        i++;
    }

    return result;
}

function processFile(file) {
    const code = fs.readFileSync(file, 'utf-8');
    const minified = file.endsWith('.js') ? stripCommentsJS(code) : stripNonJSDocTS(code);
    fs.writeFileSync(file, minified, 'utf-8');
    console.log(`Processed ${file}`);
}

function main() {
    const files = getFiles(DIST_DIR, ['.js', '.ts']);
    for (const file of files) processFile(file);
}

main();
