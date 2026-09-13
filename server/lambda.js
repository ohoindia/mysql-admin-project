const serverless = require("serverless-http");
const app = require("./index");

// Initialize Express and its MySQL pool once per warm execution environment.
const handle = serverless(app);
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  return handle(event, context);
};
