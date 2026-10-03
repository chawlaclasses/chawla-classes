"use strict";
const { getConfig } = require("../config/messaging.config");
const { MessagingError } = require("../utils/errors");
const log = require("../utils/log");

const MockProvider = require("./MockProvider");
const Fast2SmsProvider = require("./Fast2SmsProvider");
const Msg91Provider = require("./stubs/msg91");
const WhatsAppCloudProvider = require("./stubs/whatsappCloud");

/**
 * name -> factory. To add a provider: write the class, add ONE line here.
 * The stubs are registered so MESSAGING_*_PROVIDER=msg91 is recognised, but they throw a clear
 * "not implemented" error until you fill in send().
 */
const FACTORIES = {
  mock: (opts) => new MockProvider(opts),
  fast2sms: (opts) => new Fast2SmsProvider(opts),
  msg91: (opts) => new Msg91Provider(opts),
  whatsapp_cloud: (opts) => new WhatsAppCloudProvider(opts),
};

class ProviderRegistry {
  constructor(config = getConfig()) {
    this.config = config;
    this.byChannel = new Map();   // channel -> provider instance
    this.byName = new Map();      // name -> provider instance (shared across channels)
    this.deliveryHandler = null;
  }

  static register(name, factory) { FACTORIES[name.toLowerCase()] = factory; }

  /** Resolve & instantiate providers for every channel. Fails fast on bad config. */
  init(onDelivery) {
    this.deliveryHandler = onDelivery;
    for (const [channel, name] of Object.entries(this.config.providers)) {
      if (name === "mock" && this.config.isProd && !this.config.allowMockInProduction) {
        throw new MessagingError(
          `MESSAGING_${channel.toUpperCase()}_PROVIDER=mock is blocked in production. ` +
          `Set MESSAGING_ALLOW_MOCK_IN_PRODUCTION=true to run without a real provider.`,
          { code: "MOCK_BLOCKED_IN_PROD", status: 500 });
      }
      const factory = FACTORIES[name];
      if (!factory) {
        throw new MessagingError(`Unknown provider "${name}" for channel ${channel}. Known: ${Object.keys(FACTORIES).join(", ")}`,
          { code: "UNKNOWN_PROVIDER", status: 500 });
      }
      let provider = this.byName.get(name);
      if (!provider) {
        provider = factory({});
        this.byName.set(name, provider);
        if (this.deliveryHandler) provider.on("delivery", (evt) => this.deliveryHandler(provider.name, evt));
      }
      if (!provider.channels.includes(channel)) {
        throw new MessagingError(`Provider "${name}" does not support channel "${channel}"`, { code: "PROVIDER_CHANNEL_MISMATCH", status: 500 });
      }
      this.byChannel.set(channel, provider);
      log.info(`channel=${channel} -> provider=${name}`);
    }
    return this;
  }

  forChannel(channel) {
    const p = this.byChannel.get(channel);
    if (!p) throw new MessagingError(`No provider configured for channel "${channel}"`, { code: "NO_PROVIDER", status: 500 });
    return p;
  }

  byProviderName(name) { return this.byName.get(name) || null; }
  describe() {
    return [...this.byChannel.entries()].map(([channel, p]) => ({ channel, provider: p.name, capabilities: p.capabilities }));
  }
}

module.exports = ProviderRegistry;
