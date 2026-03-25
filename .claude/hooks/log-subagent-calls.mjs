#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const payload = Buffer.concat(chunks).toString('utf8');

const now = new Date();
const entry = `---\n${ now.toISOString() }\n\n${ payload }\n\n`;

const logDir  = join(process.cwd(), 'tmp');
const logFile = join(logDir, 'subagents.log');

mkdirSync(logDir, { recursive: true });
appendFileSync(logFile, entry, 'utf8');
