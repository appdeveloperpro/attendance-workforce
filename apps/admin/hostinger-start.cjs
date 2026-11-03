const { spawn } = require('node:child_process');

const appDirectory = __dirname;
const nextCli = require.resolve('next/dist/bin/next', { paths: [appDirectory] });
const port = process.env.PORT || '3001';

const server = spawn(process.execPath, [nextCli, 'start', '--port', port], {
  cwd: appDirectory,
  env: process.env,
  stdio: 'inherit',
});

server.on('error', (error) => {
  console.error('Failed to start the admin dashboard:', error);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
