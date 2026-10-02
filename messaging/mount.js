"use strict";
/**
 * app.js builds the Express app synchronously, but the messaging module needs async setup (DB connect,
 * template seeding). This gateway is mounted immediately and starts serving as soon as init() finishes;
 * until then it answers 503 instead of crashing the boot.
 */
let ready = null;
function messagingGateway() {
  return (req, res, next) => (ready ? ready(req, res, next) : res.status(503).json({ success: false, message: "Messaging is starting. Try again shortly." }));
}
function setReady(router) { ready = router; }
module.exports = { messagingGateway, setReady };
