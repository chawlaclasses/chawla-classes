"use strict";
class MessagingError extends Error {
  constructor(message, { code = "MESSAGING_ERROR", status = 400, details } = {}) {
    super(message);
    this.name = "MessagingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Thrown by providers. `retryable` tells the worker whether to back off and retry
 * (network error, 5xx, rate limit) or fail permanently (invalid number, template rejected).
 */
class ProviderError extends Error {
  constructor(message, { retryable = true, code = "PROVIDER_ERROR", providerCode, raw } = {}) {
    super(message);
    this.name = "ProviderError";
    this.retryable = retryable;
    this.code = code;
    this.providerCode = providerCode;
    this.raw = raw;
  }
}

class NotImplementedProviderError extends ProviderError {
  constructor(name) {
    super(`Provider "${name}" is a stub and not implemented yet. See messaging/providers/stubs/${name}.js`, {
      retryable: false, code: "PROVIDER_NOT_IMPLEMENTED",
    });
  }
}

module.exports = { MessagingError, ProviderError, NotImplementedProviderError };
