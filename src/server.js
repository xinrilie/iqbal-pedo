import { buildApp } from './app.js';
import { config } from './config.js';

const app = await buildApp();

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ host: config.HOST, port: config.PORT }, 'GCIMS backend listening');
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}

const shutdown = async (signal) => {
  app.log.info({ signal }, 'Shutting down GCIMS backend');
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
