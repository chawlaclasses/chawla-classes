"use strict";
/**
 * Test-only: swaps the storage layer of the messaging models for an in-memory store while still using the REAL
 * mongoose schemas for defaults + validation. Lets the full flow run in CI with no MongoDB server.
 * Requires devDependency `sift` (Mongo query matcher).
 */
const sift = require("sift");
const mongoose = require("mongoose");

const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split("."); let cur = o;
  ks.slice(0, -1).forEach((k) => { cur[k] = cur[k] ?? {}; cur = cur[k]; });
  cur[ks[ks.length - 1]] = v;
}
const clone = (o) => JSON.parse(JSON.stringify(o), (k, v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(v) : v));

function applyUpdate(obj, upd, inserting = false) {
  const ops = Object.keys(upd).some((k) => k.startsWith("$")) ? upd : { $set: upd };
  for (const [op, spec] of Object.entries(ops)) {
    for (const [k, v] of Object.entries(spec)) {
      if (op === "$set") setPath(obj, k, v);
      else if (op === "$unset") setPath(obj, k, undefined);
      else if (op === "$inc") setPath(obj, k, (getPath(obj, k) || 0) + v);
      else if (op === "$push") { const a = getPath(obj, k) || []; a.push(v); setPath(obj, k, a); }
      else if (op === "$setOnInsert" && inserting) setPath(obj, k, v);
    }
  }
}

function install(Model) {
  const store = new Map();
  const uniques = Model.schema.indexes().filter(([, o]) => o && o.unique).map(([f]) => Object.keys(f));
  const toObj = (d) => clone(d.toObject({ depopulate: true }));
  const hydrate = (o) => {
    const d = Model.hydrate(clone(o));
    d.save = async () => { await d.validate(); persist(d); return d; };
    return d;
  };
  function persist(d) {
    const o = toObj(d);
    for (const fields of uniques) {
      const vals = fields.map((f) => getPath(o, f));
      if (vals.some((v) => v === undefined || v === null)) continue;
      for (const [id, other] of store) {
        if (id !== String(o._id) && fields.every((f, i) => String(getPath(other, f)) === String(vals[i]))) {
          const e = new Error(`E11000 duplicate key ${fields.join(",")}`); e.code = 11000; throw e;
        }
      }
    }
    store.set(String(o._id), o);
  }
  const match = (q = {}) => [...store.values()].filter(sift(clone(q)));
  const query = (producer) => {
    let sortSpec, lim, skp = 0, lean = false;
    const run = async () => {
      let rows = producer();
      if (sortSpec) rows = rows.sort((a, b) => { for (const [k, dir] of Object.entries(sortSpec)) { const x = getPath(a, k), y = getPath(b, k); if (x < y) return -dir; if (x > y) return dir; } return 0; });
      rows = rows.slice(skp, lim ? skp + lim : undefined);
      return lean ? rows.map(clone) : rows.map(hydrate);
    };
    const q = { sort: (s) => (sortSpec = s, q), limit: (n) => (lim = n, q), skip: (n) => (skp = n, q), lean: () => (lean = true, q), select: () => q,
      then: (a, b) => run().then(a, b), catch: (b) => run().catch(b) };
    return q;
  };
  const one = (producer) => { const q = query(() => producer().slice(0, 1)); const t = q.then; q.then = (a, b) => t((r) => a(r[0] ?? null), b); return q; };

  Model.create = async (data) => {
    if (Array.isArray(data)) return Promise.all(data.map((x) => Model.create(x)));
    const d = new Model(data); await d.validate(); persist(d); return hydrate(toObj(d));
  };
  Model.insertMany = async (rows) => {
    const ok = [], errs = [];
    for (const r of rows) { try { ok.push(await Model.create(r)); } catch (e) { errs.push(e); } }
    if (errs.length) { const e = new Error("bulk write error"); e.code = 11000; e.writeErrors = errs; e.insertedDocs = ok; throw e; }
    return ok;
  };
  Model.find = (q) => query(() => match(q));
  Model.findOne = (q) => one(() => match(q));
  Model.findById = (id) => one(() => match({ _id: String(id) }));
  const updFirst = async (q, upd, { new: ret, upsert, sort } = {}) => {
    let rows = match(q);
    if (sort) rows.sort((a, b) => { for (const [k, dir] of Object.entries(sort)) { const x = getPath(a, k), y = getPath(b, k); if (x < y) return -dir; if (x > y) return dir; } return 0; });
    let row = rows[0], inserted = false;
    if (!row && upsert) { row = toObj(new Model(Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith("$") && typeof q[k] !== "object")))); inserted = true; }
    if (!row) return { doc: null, matched: 0 };
    const before = clone(row); applyUpdate(row, upd, inserted); store.set(String(row._id), row);
    return { doc: hydrate(ret ? row : before), matched: 1, inserted };
  };
  Model.findOneAndUpdate = (q, u, o) => ({ then: (a, b) => updFirst(q, u, o).then((r) => r.doc).then(a, b) });
  Model.findByIdAndUpdate = (id, u, o) => Model.findOneAndUpdate({ _id: String(id) }, u, o);
  Model.updateOne = async (q, u, o) => { const r = await updFirst(q, u, o); return { modifiedCount: r.matched, upsertedCount: r.inserted ? 1 : 0 }; };
  Model.updateMany = async (q, u) => { const rows = match(q); rows.forEach((r) => applyUpdate(r, u)); return { modifiedCount: rows.length }; };
  Model.countDocuments = async (q) => match(q).length;
  Model.deleteOne = async (q) => { const r = match(q)[0]; if (r) store.delete(String(r._id)); return { deletedCount: r ? 1 : 0 }; };
  Model.aggregate = async (pipe) => {
    const m = pipe.find((s) => s.$match)?.$match || {}, g = pipe.find((s) => s.$group)?.$group;
    const out = {}; match(m).forEach((r) => { const k = getPath(r, g._id.replace("$", "")); out[k] = (out[k] || 0) + 1; });
    return Object.entries(out).map(([_id, n]) => ({ _id, n }));
  };
  Model.__store = store;
  Model.__reset = () => store.clear();
}

function installAll() {
  const models = require("../models");
  Object.values(models).forEach(install);
  return models;
}
module.exports = { installAll, mongoose };
