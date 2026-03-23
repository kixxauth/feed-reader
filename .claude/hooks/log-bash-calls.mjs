#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}

const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const cmd       = payload?.tool_input?.command   ?? '';
const session   = payload?.session_id            ?? '';
const cwd       = payload?.cwd                   ?? '';
const exitCode  = payload?.tool_response?.exit_code ?? 'unknown';
const error     = payload?.error                 ?? null; // present on PostToolUseFailure
const timestamp = new Date().toISOString();

const status = error ? `error=${JSON.stringify(error)}` : `exit=${exitCode}`;
const line = `${timestamp}\tsession=${session}\tcwd=${cwd}\t${status}\tcmd=${cmd}\n`;

const logDir  = join(process.cwd(), 'tmp');
const logFile = join(logDir, 'bash-commands.log');

mkdirSync(logDir, { recursive: true });
appendFileSync(logFile, line, 'utf8');
