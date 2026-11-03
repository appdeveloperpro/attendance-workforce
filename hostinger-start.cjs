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
let apiReady = false;
let dashboardReady = false;
let apiHandler;
let nextHandler;

const server = http.createServer((request, response) => {
  const isApiRequest = request.url === '/api' || request.url.startsWith('/api/');
  if ((isApiRequest && !apiReady) || (!isApiRequest && !dashboardReady)) {
    response.writeHead(503, {
      'content-type': 'application/json',
      'retry-after': '5',
    });
    response.end(JSON.stringify({
      message: isApiRequest ? 'API is starting or unavailable.' : 'Dashboard is starting or unavailable.',
    }));
    return;
  }

  try {
    if (isApiRequest) {
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

async function initializeApi() {
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
  apiReady = true;
  console.log('API is ready.');
}

async function initializeDashboard() {
  const dashboard = next({
    dev: false,
    dir: adminDirectory,
    hostname: '127.0.0.1',
    port,
  });
  await dashboard.prepare();
  nextHandler = dashboard.getRequestHandler();
  dashboardReady = true;
  console.log('Admin dashboard is ready.');
}

server.once('error', (error) => {
  console.error('Failed to bind the Hostinger port:', error);
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Application listener bound to port ${port}.`);
  initializeApi().catch((error) => {
    console.error('API initialization failed:', error);
  });
  initializeDashboard().catch((error) => {
    console.error('Dashboard initialization failed:', error);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
