const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const rootDirectory = __dirname;
const apiDirectory = path.join(rootDirectory, 'apps', 'api');
const adminDirectory = path.join(rootDirectory, 'apps', 'admin');
const nextCli = require.resolve('next/dist/bin/next', { paths: [adminDirectory] });
const children = [];
let shuttingDown = false;
let apiPort;
let adminPort;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an internal application port.'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function startChild(command, args, cwd, env, name) {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  children.push(child);
  child.once('error', (error) => {
    console.error(`Failed to start ${name}:`, error);
    shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`${name} exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
      shutdown(code || 1);
    }
  });
}

function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  if (proxy.listening) proxy.close(() => process.exit(exitCode));
  else if (children.length === 0) process.exit(exitCode);
  setTimeout(() => process.exit(exitCode), 5000).unref();
}

const proxy = http.createServer((request, response) => {
  const useApi = request.url === '/api' || request.url.startsWith('/api/');
  const port = useApi ? apiPort : adminPort;
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `127.0.0.1:${port}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.once('error', (error) => {
    console.error(`Could not reach ${useApi ? 'API' : 'admin dashboard'}:`, error.message);
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify({ message: 'Application service is starting or unavailable.' }));
  });
  request.pipe(upstream);
});

async function main() {
  const publicPort = Number(process.env.PORT);
  if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
    throw new Error('Hostinger must provide a valid PORT environment variable.');
  }

  [apiPort, adminPort] = await Promise.all([reservePort(), reservePort()]);
  if (apiPort === adminPort) return main();

  startChild(
    process.execPath,
    [path.join(apiDirectory, 'dist', 'main.js')],
    apiDirectory,
    { ...process.env, PORT: String(apiPort) },
    'API',
  );
  startChild(
    process.execPath,
    [nextCli, 'start', '--hostname', '127.0.0.1', '--port', String(adminPort)],
    adminDirectory,
    { ...process.env, PORT: String(adminPort) },
    'admin dashboard',
  );

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => shutdown(0));
  }

  proxy.once('error', (error) => {
    console.error('Failed to start the public application listener:', error);
    shutdown(1);
  });
  proxy.listen(publicPort, '0.0.0.0', () => {
    console.log(`Dashboard and API proxy listening on port ${publicPort}.`);
  });
}

main().catch((error) => {
  console.error('Failed to start the application:', error);
  shutdown(1);
});
