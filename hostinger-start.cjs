const http = require('node:http');
const path = require('node:path');

const rootDirectory = __dirname;
const apiDirectory = path.join(rootDirectory, 'apps', 'api');
const adminDirectory = path.join(rootDirectory, 'apps', 'admin');
const dotenv = require(require.resolve('dotenv', { paths: [apiDirectory] }));
dotenv.config({ path: path.join(apiDirectory, '.env') });

require(require.resolve('reflect-metadata', { paths: [apiDirectory] }));

const { ValidationPipe } = require(require.resolve('@nestjs/common', { paths: [apiDirectory] }));
const { NestFactory } = require(require.resolve('@nestjs/core', { paths: [apiDirectory] }));
const { AppModule } = require(path.join(apiDirectory, 'dist', 'app.module.js'));
const next = require(require.resolve('next', { paths: [adminDirectory] }));

const port = Number(process.env.PORT || 3000);
const server = http.createServer((request, response) => {
  if (!applicationReady) {
    response.writeHead(503, {
      'content-type': 'application/json',
      'retry-after': '5',
    });
    response.end(JSON.stringify({ message: 'Application is starting.' }));
    return;
  }

  try {
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      apiHandler(request, response);
    } else {
      nextHandler(request, response);
    }
  } catch (error) {
    console.error('Request handler failed:', error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Internal Server Error');
  }
});

let applicationReady = false;
let apiHandler;
let nextHandler;

async function initializeApplications() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters.');
  }

  const api = await NestFactory.create(AppModule);
  const origins = (process.env.ADMIN_WEB_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim());
  api.enableCors({ origin: origins, credentials: false });
  api.setGlobalPrefix('api');
  api.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await api.init();
  apiHandler = api.getHttpAdapter().getInstance();

  const dashboard = next({
    dev: false,
    dir: adminDirectory,
    hostname: '127.0.0.1',
    port,
  });
  await dashboard.prepare();
  nextHandler = dashboard.getRequestHandler();
  applicationReady = true;
  console.log('Admin dashboard and API are ready.');
}

server.once('error', (error) => {
  console.error('Failed to bind the Hostinger port:', error);
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Application listener bound to port ${port}.`);
  initializeApplications().catch((error) => {
    console.error('Application initialization failed:', error);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
