#!/usr/bin/env node
// npm run dev: the server (npm run server: tsx watch, data in .data/) and Vite, whose /api proxy reaches it, as one
// command. Ctrl-C stops both; when Vite ends, the server is stopped and this exits with Vite's code.
import { spawn } from 'node:child_process';
import process from 'node:process';

// The server runs in a process group of its own, signalled as a whole: npm and tsx watch do not pass a signal on to
// the node process under them, which would be left holding the port and the lock on .data/. Vite stays in the
// terminal's group, where it reads the keyboard.
const server = spawn('npm', ['run', '-s', 'server'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
const vite = spawn('./node_modules/.bin/vite', process.argv.slice(2), { stdio: 'inherit' });

const stopServer = (signal) => {
  try {
    process.kill(-server.pid, signal);
  } catch {
    // The group is already gone.
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopServer(signal);
    vite.kill(signal);
  });
}
vite.on('exit', (code) => {
  stopServer('SIGTERM');
  process.exitCode = code ?? 1;
});
server.on('exit', () => vite.kill('SIGTERM'));
