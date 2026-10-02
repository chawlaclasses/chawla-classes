"use strict";
const log = require("../utils/log");

/** POST /webhooks/:provider — vendor delivery receipts. Always answer 200 quickly once authenticated. */
module.exports = (c) => async (req, res) => {
  const provider = c.registry.byProviderName(req.params.provider);
  if (!provider) return res.status(404).json({ success: false });
  if (!provider.verifyWebhook(req)) return res.status(401).json({ success: false });
  try {
    for (const evt of provider.parseWebhook(req)) await c.receipts.apply(provider.name, evt);
  } catch (e) { log.error(`webhook ${provider.name}: ${e.message}`); }
  res.json({ success: true });
};
