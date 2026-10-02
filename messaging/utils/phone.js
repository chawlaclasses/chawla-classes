"use strict";
/** Normalise Indian mobile numbers to E.164 (+91XXXXXXXXXX). Returns null if invalid. */
function normalizePhone(input, defaultCountryCode = "91") {
  if (input === undefined || input === null) return null;
  let d = String(input).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = defaultCountryCode + d;
  if (defaultCountryCode === "91") {
    if (!/^91[6-9]\d{9}$/.test(d)) return null;
  } else if (!/^\d{8,15}$/.test(d)) return null;
  return "+" + d;
}

/** 9876543210 -> +91******3210 (safe for logs) */
function maskPhone(e164) {
  if (!e164) return "";
  return e164.slice(0, 3) + "*".repeat(Math.max(0, e164.length - 7)) + e164.slice(-4);
}

module.exports = { normalizePhone, maskPhone };
