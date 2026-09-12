const serverless = require('serverless-http');
const app = require('./index');

// Initialize Express and its MySQL pool once per warm execution environment.
const handle = serverless(app);
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const response = await handle(event, context);
  // Express emits a string for one cookie; HTTP API v2 expects a cookies array.
  if (event.version === '2.0' && response.headers?.['set-cookie']) {
    response.cookies = [...(response.cookies || []), response.headers['set-cookie']];
    delete response.headers['set-cookie'];
  }
  return response;
};
