#!/usr/bin/env node
/**
 * hydrate-template.js
 *
 * Reads a plain text template file and a YAML context file, substitutes
 * {{variable}} placeholders with values from the YAML, and writes the
 * result to stdout.
 *
 * Usage:
 *   node tools/hydrate-template.js <template-file> <context-yaml-file>
 *
 * Example:
 *   node tools/hydrate-template.js prompt-templates/epic-to-implementation.md context.yaml
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';

const [, , templateArg, contextArg] = process.argv;

if (!templateArg || !contextArg) {
    process.stderr.write('Usage: hydrate-template.js <template-file> <context-yaml-file>\n');
    process.exit(1);
}

const templatePath = resolve(templateArg);
const contextPath = resolve(contextArg);

let template;
try {
    template = readFileSync(templatePath, 'utf8');
} catch (err) {
    process.stderr.write(`Error reading template file: ${err.message}\n`);
    process.exit(1);
}

let context;
try {
    context = yaml.load(readFileSync(contextPath, 'utf8'));
} catch (err) {
    process.stderr.write(`Error reading context file: ${err.message}\n`);
    process.exit(1);
}

if (typeof context !== 'object' || context === null || Array.isArray(context)) {
    process.stderr.write('Context YAML must be a mapping of key/value pairs.\n');
    process.exit(1);
}

const result = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
        return context[key];
    }
    process.stderr.write(`Warning: no value for {{${key}}}, leaving as-is.\n`);
    return match;
});

process.stdout.write(result);
