import { spawn } from 'node:child_process';
import { join } from 'node:path';

// The start without Docker (deploy/start-hazelle.bat, deploy/install.sh): the image's /app, copied out by the release
// workflow, with data/ beside it, reachable from this machine only. Another device needs HTTPS in front anyway, since
// the vault's secure context holds on localhost alone (README.ko.md).
const app = join(import.meta.dirname, '..', '..');
const port = process.env.PORT || '8080';
const url = `http://localhost:${port}`;
// Defaults: a value the operator sets before the start, as README.ko.md shows for PORT, wins.
const defaults = {
  NODE_ENV: 'production',
  HAZELLE_DATA: join(app, '..', 'data'),
  HAZELLE_CLIENT: join(app, 'dist', 'client'),
  HAZELLE_HOST: '127.0.0.1',
  // Ollama, LM Studio and koboldcpp, as in docker-compose.yml, but at localhost: no container stands in between.
  HAZELLE_LOCAL_PROVIDERS: 'localhost:11434,localhost:1234,localhost:5001',
  HAZELLE_PULSE_FORWARD: 'https://hazelle.app',
};
for (const [name, value] of Object.entries(defaults)) process.env[name] ??= value;

const [command, args] = ({ win32: ['cmd', ['/c', 'start', '', url]], android: ['termux-open-url', [url]], darwin: ['open', [url]] } as const)[
  process.platform as 'win32' | 'android' | 'darwin'
] ?? ['xdg-open', [url]];
const openBrowser = () => spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();

// A second start finds the first holding data/ (node.ts's lock), so it shows the running one instead.
if (await fetch(`http://127.0.0.1:${port}/api/health`).then((answer) => answer.ok, () => false)) {
  console.log(`헤이젤은 이미 켜져 있어요: ${url}`);
} else {
  await import(new URL('./node.js', import.meta.url).href);
  console.log(`헤이젤이 켜졌어요: ${url}\n이 창을 닫으면 꺼져요.`);
}
openBrowser();
