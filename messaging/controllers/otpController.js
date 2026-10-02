"use strict";
const { handle, need } = require("./helpers");

module.exports = (c) => ({
  /** POST /otp/request  { phone, purpose } */
  request: handle(async (req) => {
    need(req.body, "phone");
    return c.otp.request({ phone: req.body.phone, purpose: req.body.purpose, ip: req.ip });
  }),
  /** POST /otp/verify  { phone, purpose, code } -> { verified, verificationToken } */
  verify: handle(async (req) => {
    need(req.body, "phone", "code");
    return c.otp.verify({ phone: req.body.phone, purpose: req.body.purpose, code: req.body.code });
  }),
});
