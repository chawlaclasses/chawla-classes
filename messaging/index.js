"use strict";
/**
 * Messaging module entry point.
 *
 *   const messaging = require("./messaging");
 *   const { router } = await messaging.init();          // connects, seeds templates, starts worker
 *   app.use("/api/messaging", router);
 *
 * Business code elsewhere in the app only needs the facade:
 *   messaging.get().enquiry.onEnquiryCreated(enquiry)
 *   messaging.get().otp.request({ phone, purpose })
 */
const mongoose = require("mongoose");
const log = require("./utils/log");
const { buildContainer } = require("./container");
const { buildRouter } = require("./routes");

let container = null;

async function ensureMongoose() {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) { await mongoose.connection.asPromise(); return; }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (messaging module needs a mongoose connection)");
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || undefined, serverSelectionTimeoutMS: 10000 });
  log.info("mongoose connected for messaging module");
}

/**
 * @param {{ requireAdmin?: Function, seedTemplates?: boolean, startWorker?: boolean }} opts
 * @returns {Promise<{ router, container }>}
 */
async function init(opts = {}) {
  if (container) return { router: container.router, container };
  await ensureMongoose();
  const c = buildContainer();
  if (opts.seedTemplates !== false) await c.templates.seedDefaults();
  if (opts.startWorker !== false) { c.worker.start(); c.fees.start(); }
  c.router = buildRouter(c, { requireAdmin: opts.requireAdmin });
  require("./mount").setReady(c.router);   // switch the 503 gateway in app.js to the live router
  container = c;
  log.info(`messaging ready: ${c.registry.describe().map((d) => `${d.channel}=${d.provider}`).join(", ")}`);
  return { router: c.router, container: c };
}

function get() {
  if (!container) throw new Error("messaging.init() has not been called yet");
  return container;
}

async function shutdown() {
  if (!container) return;
  container.fees.stop();
  await container.worker.stop();
  container = null;
}

module.exports = { init, get, shutdown };
