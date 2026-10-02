"use strict";
/**
 * Composition root — the only place that wires concrete classes together.
 * Everything else receives its dependencies through constructors (easy to unit-test and to swap).
 */
const { getConfig } = require("./config/messaging.config");
const ProviderRegistry = require("./providers/ProviderRegistry");
const TemplateService = require("./services/TemplateService");
const MessagingService = require("./services/MessagingService");
const DeliveryReceiptService = require("./services/DeliveryReceiptService");
const OtpService = require("./services/OtpService");
const RecipientResolver = require("./services/RecipientResolver");
const BulkMessagingService = require("./services/BulkMessagingService");
const EnquiryFollowUpService = require("./services/EnquiryFollowUpService");
const FeeReminderService = require("./services/FeeReminderService");
const StudentNoticeService = require("./services/StudentNoticeService");
const ParentNotificationService = require("./services/ParentNotificationService");
const DispatchWorker = require("./queue/DispatchWorker");

function buildContainer(config = getConfig()) {
  const templates = new TemplateService();
  const receipts = new DeliveryReceiptService();
  const registry = new ProviderRegistry(config).init((provider, evt) => receipts.apply(provider, evt).catch(() => {}));
  const messaging = new MessagingService({ config, registry, templates });
  const resolver = new RecipientResolver(config);
  const bulk = new BulkMessagingService({ config, messaging, templates, resolver });
  return {
    config, registry, templates, receipts, messaging, resolver, bulk,
    otp: new OtpService({ config, messaging }),
    enquiry: new EnquiryFollowUpService({ config, messaging }),
    fees: new FeeReminderService({ config, messaging }),
    notices: new StudentNoticeService({ config, bulk }),
    parents: new ParentNotificationService({ config, messaging }),
    worker: new DispatchWorker({ config, messaging, bulk }),
  };
}

module.exports = { buildContainer };
