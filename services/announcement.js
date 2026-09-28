/**
 * services/announcement.js
 */

"use strict";

const storage = require("./storage");

function get() {
  return storage.read("announcement.json");
}

function set(message) {
  if (!message || !String(message).trim()) {
    throw Object.assign(new Error("Announcement message required"), { status: 400 });
  }
  storage.write("announcement.json", { message: String(message).trim() });
  return { success: true };
}

module.exports = { get, set };
