"use strict";
/**
 * HostDataAdapter — the ONLY file that knows how the rest of the app stores students, fees and
 * enquiries. Today: services/jsonDb collections `users` (role:student), `fees-v2`, `enquiries`, `classes`.
 * When V2 moves these to Mongoose models, rewrite this file (or call setHostAdapter(...)) and no
 * messaging service changes.
 *
 * Contract (all async):
 *   getStudent(id)                -> { id, name, phone, parentName, parentPhone, classId, className, batch } | null
 *   listStudents({classId,batch,studentIds}) -> Student[]
 *   getFee(id)                    -> Fee | null
 *   listPendingFees()             -> Fee[]       // Fee = { id, studentId, title, amount(net payable), dueDate, status }
 *   getEnquiry(id)                -> { id, name, phone, interestedClass, status } | null
 *   listEnquiries({status,since}) -> Enquiry[]
 */
let db;
try { db = require("../../services/jsonDb"); } catch { db = null; }
let feeCalc;
try { feeCalc = require("../../services/feeCalc"); } catch { feeCalc = null; }

const idOf = (d) => String(d._id || d.id);

async function className(classId) {
  if (!classId || !db) return "";
  const c = await db.findById("classes", classId);
  return c ? (c.displayName || c.name || "") : "";
}

async function toStudent(u) {
  if (!u) return null;
  return {
    id: idOf(u), name: u.name || "Student",
    phone: u.phone || u.contactPhone || "",
    parentName: u.parentName || "Parent", parentPhone: u.parentPhone || "",
    classId: u.classId, className: await className(u.classId), batch: u.batch || "",
  };
}

const defaultAdapter = {
  async getStudent(id) { return toStudent(await db.findById("users", id)); },

  async listStudents({ classId, batch, studentIds } = {}) {
    let list = await db.find("users", { role: "student" });
    list = list.filter((u) => u.isActive !== false);
    if (classId) list = list.filter((u) => u.classId === classId);
    if (batch) list = list.filter((u) => u.batch === batch);
    if (studentIds?.length) { const s = new Set(studentIds.map(String)); list = list.filter((u) => s.has(idOf(u))); }
    return Promise.all(list.map(toStudent));
  },

  _fee(f) {
    const c = feeCalc ? feeCalc.feeWithComputed(f) : f;
    return { id: idOf(f), studentId: f.studentId, title: f.title || f.description || "Fee", amount: c.netPayable ?? f.amount, dueDate: f.dueDate, status: f.status };
  },
  async getFee(id) { const f = await db.findById("fees-v2", id); return f ? this._fee(f) : null; },
  async listPendingFees() { return (await db.find("fees-v2", { status: "Pending" })).map((f) => this._fee(f)); },

  async getEnquiry(id) {
    const e = await db.findById("enquiries", id);
    return e ? { id: idOf(e), name: e.name || e.studentName, phone: e.phone, interestedClass: e.interestedClass || "", status: e.status || "new" } : null;
  },
  async listEnquiries({ status } = {}) {
    let list = await db.find("enquiries", {});
    if (status) list = list.filter((e) => (e.status || "new") === status);
    return list.map((e) => ({ id: idOf(e), name: e.name || e.studentName, phone: e.phone, interestedClass: e.interestedClass || "", status: e.status || "new" }));
  },
};

let current = defaultAdapter;
module.exports = {
  getHostAdapter: () => current,
  setHostAdapter: (a) => { current = { ...defaultAdapter, ...a }; },
};
