'use strict';

const express = require('express');
const config = require('./config');
const logger = require('./logger');
const { getDb } = require('./db');
const worker = require('./worker');
const routes = require('./routes');

getDb();
logger.info('Database initialized');

const app = express();
app.use(express.json());

app.get('/', routes.homeHandler);
app.get('/health', routes.healthHandler);
app.get('/status', routes.statusHandler);
app.post('/run-now', routes.runNowHandler);

worker.runPoll()
  .then(() => {
    worker.startScheduler();
  })
  .catch((err) => {
    logger.error('Initial poll failed', { message: err.message });
    worker.startScheduler();
  });

app.listen(config.port, () => {
  logger.info('Server started', { port: config.port, env: config.nodeEnv });
});
