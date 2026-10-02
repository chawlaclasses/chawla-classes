"use strict";
/**
 * Starter templates (seeded only if missing — your edits are never overwritten).
 * Same text is created for SMS and WhatsApp. When you go live with DLT/WhatsApp you MUST register
 * the exact text with the vendor and put the ids in `providerRefs` (admin API: PUT /templates/:id).
 */
const { CATEGORIES } = require("../constants");
const T = CATEGORIES.TRANSACTIONAL, S = CATEGORIES.SERVICE, P = CATEGORIES.PROMOTIONAL;

module.exports = [
  { key: "otp_verification", name: "OTP verification", category: T, sensitive: true,
    body: "{{code}} is your Chawla Classes verification code. Valid for {{minutes}} minutes. Do not share it with anyone." },

  { key: "enquiry_welcome", name: "Enquiry received", category: S,
    body: "Hello {{name}}, thank you for your enquiry about {{course}} at Chawla Classes. Our counsellor will call you shortly. Call: {{contact}}" },
  { key: "enquiry_followup_1", name: "Enquiry follow-up 1", category: S,
    body: "Hi {{name}}, a quick follow-up on your enquiry for {{course}} at Chawla Classes. Visit us or reply to book a free demo class. Call: {{contact}}" },
  { key: "enquiry_followup_2", name: "Enquiry follow-up 2", category: S,
    body: "Hi {{name}}, seats for {{course}} at Chawla Classes are filling fast. Admissions are open - call {{contact}} to reserve your seat." },

  { key: "fee_due_upcoming", name: "Fee due soon", category: T,
    body: "Dear {{name}}, fee of Rs {{amount}} for {{student}} ({{title}}) is due on {{dueDate}}. - Chawla Classes" },
  { key: "fee_due_today", name: "Fee due today", category: T,
    body: "Dear {{name}}, fee of Rs {{amount}} for {{student}} ({{title}}) is due today. Please pay at the institute. - Chawla Classes" },
  { key: "fee_overdue", name: "Fee overdue", category: T,
    body: "Dear {{name}}, fee of Rs {{amount}} for {{student}} ({{title}}) was due on {{dueDate}} and is overdue by {{daysOverdue}} days. Please pay at the earliest. - Chawla Classes" },
  { key: "fee_payment_received", name: "Fee payment received", category: T,
    body: "Dear {{name}}, we received Rs {{amount}} for {{student}} ({{title}}). Thank you! - Chawla Classes" },

  { key: "student_notice", name: "Student notice", category: S,
    body: "Chawla Classes Notice: {{title}} - {{message}}" },
  { key: "parent_notice", name: "Parent notice", category: S,
    body: "Dear {{name}}, notice from Chawla Classes: {{title}} - {{message}}" },

  { key: "parent_absence_alert", name: "Parent: absence alert", category: T,
    body: "Dear {{name}}, {{student}} was marked absent on {{date}} at Chawla Classes." },
  { key: "parent_result_published", name: "Parent: result published", category: T,
    body: "Dear {{name}}, {{student}} scored {{marks}} in {{exam}}. Details are available in the student app. - Chawla Classes" },
  { key: "parent_custom_message", name: "Parent: custom message", category: S,
    body: "Dear {{name}}, regarding {{student}}: {{message}} - Chawla Classes" },

  { key: "promo_announcement", name: "Promotional announcement", category: P,
    body: "Chawla Classes: {{message}} Reply STOP to opt out." },
];
