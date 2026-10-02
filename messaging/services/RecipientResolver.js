"use strict";
const { getHostAdapter } = require("../adapters/hostDataAdapter");
const { normalizePhone } = require("../utils/phone");

/**
 * Turns an audience definition into a de-duplicated recipient list:
 *   [{ phone, name, userId, type, variables }]
 * `variables` are per-recipient template values (merged over campaign-wide variables).
 */
class RecipientResolver {
  constructor(config) { this.config = config; }

  async resolve(audience) {
    const host = getHostAdapter();
    let list = [];
    switch (audience.kind) {
      case "students": {
        const students = await host.listStudents(audience.filter || {});
        list = students.map((s) => ({ phone: s.phone, name: s.name, userId: s.id, type: "student",
          variables: { name: s.name, student: s.name, className: s.className } }));
        break;
      }
      case "parents": {
        const students = await host.listStudents(audience.filter || {});
        list = students.map((s) => ({ phone: s.parentPhone, name: s.parentName, userId: s.id, type: "parent",
          variables: { name: s.parentName, student: s.name, className: s.className } }));
        break;
      }
      case "enquiries": {
        const enq = await host.listEnquiries(audience.filter || {});
        list = enq.map((e) => ({ phone: e.phone, name: e.name, userId: e.id, type: "enquiry",
          variables: { name: e.name, course: e.interestedClass || "our courses" } }));
        break;
      }
      case "custom":
        list = (audience.customRecipients || []).map((r) => ({ phone: r.phone, name: r.name, type: "other", variables: { name: r.name, ...(r.variables || {}) } }));
        break;
      default:
        throw new Error(`Unknown audience kind ${audience.kind}`);
    }

    const seen = new Set();
    const valid = [], invalid = [];
    for (const r of list) {
      const p = normalizePhone(r.phone, this.config.defaultCountryCode);
      if (!p) { invalid.push(r); continue; }
      if (seen.has(p)) continue;          // siblings / duplicate numbers get ONE message
      seen.add(p);
      valid.push({ ...r, phone: p });
    }
    return { recipients: valid, invalid: invalid.length, total: list.length };
  }
}

module.exports = RecipientResolver;
