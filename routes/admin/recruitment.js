/**
 * routes/admin/recruitment.js
 *
 * Admin-side Faculty Recruitment (Careers) management — the ATS half of
 * the module. Public submission lives in routes/recruitment.js instead
 * (no auth there, by design). Mounted at '/recruitment' by
 * routes/adminRoutes.js, under app.js's '/api/admin' + requireApiAdmin,
 * so every route below already has req.userData set.
 *
 * Access: admin/super_admin only (recruitment:*) — see config/permissions.js.
 * Teacher/reception/accountant get nothing; candidate PII has no reason to
 * be visible to teaching staff.
 */

"use strict";

const express = require("express");
const router = express.Router();
const path = require("path");

const db = require("../../services/jsonDb");
const logger = require("../../utils/logger");
const { logAudit } = require("../../utils/auditLog");
const { requirePermission } = require("../../middleware/permissions");
const { validate } = require("../../middleware/validation");
const validators = require("../../utils/validators");
const { FACULTY_APPLICATIONS_DIR } = require("../../config");
const r2Service = require("../../services/r2Service");
const { sendMail, isConfigured: mailConfigured } = require("../../utils/mailer");
const { sendWhatsApp, isConfigured: whatsappConfigured } = require("../../utils/whatsapp");

const STATUS_FLOW = ["applied", "screening", "shortlisted", "interview_scheduled", "demo_class", "selected", "offer_sent", "joined"];
const TERMINAL_STATUSES = ["joined", "rejected"];

// ── Candidate notifications ──────────────────────────────────────────────
// Best-effort on both channels — a slow/misconfigured mail or WhatsApp
// provider should never block an admin action. "Application Received" is
// sent separately, from routes/recruitment.js at submission time, since
// that's a different auth context (public, not this admin router).
const EMAIL_TEMPLATES = {
  demo_class: (a) => ({
    subject: "Demo Class — Chawla Classes",
    html: `<p>Hi ${a.fullName},</p><p>Thanks for your time so far. We'd like to invite you for a short demo class as the next step. Our team will share the topic, class, and timing separately.</p><p>— Chawla Classes</p>`,
  }),
  selected: (a) => ({
    subject: "You've Been Selected — Chawla Classes",
    html: `<p>Hi ${a.fullName},</p><p>Congratulations — you've been selected to join the faculty at Chawla Classes! Our team will reach out shortly with the offer details.</p><p>— Chawla Classes</p>`,
  }),
  rejected: (a) => ({
    subject: "Application Update — Chawla Classes",
    html: `<p>Hi ${a.fullName},</p><p>Thank you for applying and for the time you invested in the process. We've decided to move forward with other candidates for this role, but we'll keep your application on file for future openings.</p><p>— Chawla Classes</p>`,
  }),
  joined: (a) => ({
    subject: "Welcome to Chawla Classes — Joining Instructions",
    html: `<p>Hi ${a.fullName},</p><p>Welcome aboard! We're excited to have you join the faculty. Our admin team will be in touch shortly with your joining formalities and schedule.</p><p>— Chawla Classes</p>`,
  }),
};

function notifyCandidate(application, template) {
  if (!template) return;
  if (application.email && mailConfigured()) {
    sendMail({ to: application.email, subject: template.subject, html: template.html })
      .catch(err => logger.error(`Faculty application email (${application._id}) failed: ${err.message}`));
  }
  if (application.phone && whatsappConfigured()) {
    // WhatsApp body is plain text — strip the HTML tags from the same template rather than maintaining two copies.
    const text = template.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    sendWhatsApp({ to: application.phone, body: text })
      .catch(err => logger.error(`Faculty application WhatsApp (${application._id}) failed: ${err.message}`));
  }
}

function withComputed(a) {
  const position = a.positionId ? db.findById("facultyPositions", a.positionId) : null;
  return {
    _id: a._id,
    fullName: a.fullName,
    phone: a.phone,
    email: a.email,
    photo: a.photo,
    qualification: a.qualification,
    experience: a.experience,
    preferredSubjects: a.preferredSubjects,
    preferredClasses: a.preferredClasses,
    employmentType: a.employmentType,
    positionId: a.positionId || "",
    positionTitle: position ? position.title : "",
    status: a.status,
    createdAt: a.createdAt,
    hasResume: !!a.resume,
    certificateCount: (a.certificates || []).length,
    hasDemoVideo: !!a.demoVideo,
  };
}

// ============================================================
// Dashboard — status funnel counts
// ============================================================
router.get("/dashboard", requirePermission("recruitment:view"), (req, res) => {
  try {
    const all = db.find("facultyApplications", {});
    const countOf = status => all.filter(a => a.status === status).length;
    res.json({
      success: true,
      data: {
        total: all.length,
        applied: countOf("applied"),
        screening: countOf("screening"),
        shortlisted: countOf("shortlisted"),
        interviewScheduled: countOf("interview_scheduled"),
        demoPending: countOf("demo_class"),
        selected: countOf("selected"),
        offerSent: countOf("offer_sent"),
        joined: countOf("joined"),
        rejected: countOf("rejected"),
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// List — filters (subject, experience, qualification, status, date) + search
// ============================================================
router.get("/", requirePermission("recruitment:view"), (req, res) => {
  try {
    const { status, subject, qualification, experience, dateFrom, dateTo, search, positionId } = req.query;

    let applications = db.find("facultyApplications", {});
    if (status) applications = applications.filter(a => a.status === status);
    if (positionId) applications = applications.filter(a => a.positionId === positionId);
    if (subject) applications = applications.filter(a => (a.preferredSubjects || "").toLowerCase().includes(subject.toLowerCase()));
    if (qualification) applications = applications.filter(a => (a.qualification || "").toLowerCase().includes(qualification.toLowerCase()));
    if (experience) applications = applications.filter(a => (a.experience || "").toLowerCase().includes(experience.toLowerCase()));
    if (dateFrom) applications = applications.filter(a => new Date(a.createdAt) >= new Date(dateFrom));
    if (dateTo) applications = applications.filter(a => new Date(a.createdAt) <= new Date(dateTo));
    if (search) {
      const q = search.toLowerCase();
      applications = applications.filter(a =>
        (a.fullName || "").toLowerCase().includes(q) ||
        (a.phone || "").includes(q) ||
        (a.email || "").toLowerCase().includes(q)
      );
    }

    applications = applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ success: true, data: applications.map(withComputed) });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Reports — by month, by subject, by experience, hiring funnel
// ============================================================
router.get("/reports", requirePermission("recruitment:view"), (req, res) => {
  try {
    const all = db.find("facultyApplications", {});

    const byMonth = {};
    for (const a of all) {
      const key = (a.createdAt || "").slice(0, 7); // YYYY-MM
      if (!key) continue;
      byMonth[key] = (byMonth[key] || 0) + 1;
    }

    const bySubject = {};
    for (const a of all) {
      const subjects = (a.preferredSubjects || "Not specified").split(",").map(s => s.trim()).filter(Boolean);
      for (const s of subjects.length ? subjects : ["Not specified"]) {
        bySubject[s] = (bySubject[s] || 0) + 1;
      }
    }

    const byExperience = {};
    for (const a of all) {
      const key = a.experience || "Not specified";
      byExperience[key] = (byExperience[key] || 0) + 1;
    }

    const funnel = STATUS_FLOW.map(status => ({
      status,
      count: all.filter(a => a.status === status || STATUS_FLOW.indexOf(a.status) > STATUS_FLOW.indexOf(status)).length,
    }));

    const byPosition = {};
    for (const a of all) {
      const position = a.positionId ? db.findById("facultyPositions", a.positionId) : null;
      const key = position ? position.title : "Not specified";
      byPosition[key] = (byPosition[key] || 0) + 1;
    }

    const selectedOrJoined = all.filter(a => a.status === "selected" || a.status === "offer_sent" || a.status === "joined").length;
    const selectionRatio = all.length ? Math.round((selectedOrJoined / all.length) * 1000) / 10 : 0;

    res.json({
      success: true,
      data: {
        byMonth: Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count })),
        bySubject: Object.entries(bySubject).sort((a, b) => b[1] - a[1]).map(([subject, count]) => ({ subject, count })),
        byExperience: Object.entries(byExperience).map(([experience, count]) => ({ experience, count })),
        byPosition: Object.entries(byPosition).sort((a, b) => b[1] - a[1]).map(([position, count]) => ({ position, count })),
        hiringFunnel: funnel,
        rejected: all.filter(a => a.status === "rejected").length,
        selectionRatio, // % of all applicants who reached selected/offer_sent/joined
      },
    });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Single candidate — full detail
// ============================================================
// ============================================================
// Job Positions — admin CRUD. Public read-only list lives in
// routes/recruitment.js (GET /api/careers/positions, open ones only).
// ============================================================
router.get("/positions", requirePermission("recruitment:view"), (req, res) => {
  try {
    const positions = db.find("facultyPositions", {}).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // Applicant count per position, handy for "don't delete, just close" decisions.
    const applications = db.find("facultyApplications", {});
    const withCounts = positions.map(p => ({ ...p, applicantCount: applications.filter(a => a.positionId === p._id).length }));
    res.json({ success: true, data: withCounts });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.post("/positions", requirePermission("recruitment:edit"), validators.createPosition, validate, (req, res) => {
  try {
    const { title, description, qualification, experience, employmentType, salary, status } = req.body;
    const position = db.insertOne("facultyPositions", {
      title: title.trim(),
      description: (description || "").trim(),
      qualification: (qualification || "").trim(),
      experience: (experience || "").trim(),
      employmentType: employmentType || "",
      salary: (salary || "").trim(),
      status: status || "open",
      createdBy: req.userData.name,
    });
    logAudit(req, "create", "faculty-position", position._id, `Added position "${position.title}"`);
    res.status(201).json({ success: true, data: position, message: "Position created" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

router.put("/positions/:id", requirePermission("recruitment:edit"), validators.createPosition, validate, (req, res) => {
  try {
    const existing = db.findById("facultyPositions", req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Position not found" });

    const { title, description, qualification, experience, employmentType, salary, status } = req.body;
    const updated = db.findByIdAndUpdate("facultyPositions", req.params.id, {
      title: title.trim(),
      description: (description || "").trim(),
      qualification: (qualification || "").trim(),
      experience: (experience || "").trim(),
      employmentType: employmentType || "",
      salary: (salary || "").trim(),
      status: status || existing.status,
    });
    logAudit(req, "edit", "faculty-position", req.params.id, `Updated position "${updated.title}"`);
    res.json({ success: true, data: updated, message: "Position updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// "Close" is just status:'closed' via PUT above — this route is the
// explicit hard-delete the spec asks for, kept separate so closing (the
// common case) never accidentally deletes applicant history.
router.delete("/positions/:id", requirePermission("recruitment:edit"), (req, res) => {
  try {
    const existing = db.findById("facultyPositions", req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Position not found" });
    db.findByIdAndDelete("facultyPositions", req.params.id);
    logAudit(req, "delete", "faculty-position", req.params.id, `Deleted position "${existing.title}"`);
    res.json({ success: true, message: "Position deleted" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});


router.get("/:id", requirePermission("recruitment:view"), (req, res) => {
  try {
    const application = db.findById("facultyApplications", req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });
    res.json({ success: true, data: application });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Status workflow
// ============================================================
router.put("/:id/status", requirePermission("recruitment:edit"), validators.updateApplicationStatus, validate, (req, res) => {
  try {
    const application = db.findById("facultyApplications", req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const { status } = req.body;
    const history = [...(application.statusHistory || []), { status, at: new Date().toISOString(), by: req.userData.name }];
    const updated = db.findByIdAndUpdate("facultyApplications", req.params.id, { status, statusHistory: history });

    if (EMAIL_TEMPLATES[status]) notifyCandidate(updated, EMAIL_TEMPLATES[status](updated));

    logAudit(req, "edit", "faculty-application", req.params.id, `Status changed to "${status}" for ${application.fullName}`);
    logger.info(`Faculty application ${req.params.id} status -> ${status} (by ${req.userData.email})`);

    res.json({ success: true, data: updated, message: "Status updated" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Admin notes — internal only, never exposed to the applicant
// ============================================================
router.post("/:id/notes", requirePermission("recruitment:edit"), validators.addApplicationNote, validate, (req, res) => {
  try {
    const application = db.findById("facultyApplications", req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const note = { text: req.body.note, by: req.userData.name, at: new Date().toISOString() };
    const notes = [...(application.adminNotes || []), note];
    const updated = db.findByIdAndUpdate("facultyApplications", req.params.id, { adminNotes: notes });

    res.status(201).json({ success: true, data: updated, message: "Note added" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Interview scheduling
// ============================================================
router.put("/:id/interview", requirePermission("recruitment:edit"), validators.scheduleInterview, validate, (req, res) => {
  try {
    const application = db.findById("facultyApplications", req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const { date, time, interviewer, meetingLink, remarks } = req.body;
    const interview = { date, time: time || "", interviewer: interviewer || "", meetingLink: meetingLink || "", remarks: remarks || "" };

    // Scheduling an interview implies moving the status forward, unless
    // the candidate is already further along than that (or already out
    // of the pipeline) — never move status backward by accident.
    const nextStatus = STATUS_FLOW.indexOf(application.status) < STATUS_FLOW.indexOf("interview_scheduled") && !TERMINAL_STATUSES.includes(application.status)
      ? "interview_scheduled"
      : application.status;
    const history = nextStatus !== application.status
      ? [...(application.statusHistory || []), { status: nextStatus, at: new Date().toISOString(), by: req.userData.name }]
      : application.statusHistory;

    const updated = db.findByIdAndUpdate("facultyApplications", req.params.id, { interview, status: nextStatus, statusHistory: history });

    notifyCandidate(updated, {
      subject: "Interview Scheduled — Chawla Classes",
      html: `<p>Hi ${application.fullName},</p><p>Your interview has been scheduled for <strong>${date}${time ? ` at ${time}` : ""}</strong>${interviewer ? ` with ${interviewer}` : ""}.</p>${meetingLink ? `<p>Meeting link: ${meetingLink}</p>` : ""}${remarks ? `<p>${remarks}</p>` : ""}<p>— Chawla Classes</p>`,
    });

    logAudit(req, "edit", "faculty-application", req.params.id, `Interview scheduled for ${application.fullName} on ${date}`);
    logger.info(`Interview scheduled for faculty application ${req.params.id}`);

    res.json({ success: true, data: updated, message: "Interview scheduled" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// Demo class evaluation
// ============================================================
router.put("/:id/demo-evaluation", requirePermission("recruitment:edit"), validators.recordDemoEvaluation, validate, (req, res) => {
  try {
    const application = db.findById("facultyApplications", req.params.id);
    if (!application) return res.status(404).json({ success: false, message: "Application not found" });

    const { topic, class: className, duration, subjectKnowledge, communication, confidence, classroomHandling, studentInteraction, boardWork, overallRating } = req.body;
    const demoEvaluation = {
      topic: topic || "", class: className || "", duration: duration || "",
      subjectKnowledge: subjectKnowledge ?? null, communication: communication ?? null,
      confidence: confidence ?? null, classroomHandling: classroomHandling ?? null,
      studentInteraction: studentInteraction ?? null, boardWork: boardWork ?? null, overallRating: overallRating ?? null,
      evaluatedBy: req.userData.name, evaluatedAt: new Date().toISOString(),
    };

    const nextStatus = STATUS_FLOW.indexOf(application.status) < STATUS_FLOW.indexOf("demo_class") && !TERMINAL_STATUSES.includes(application.status)
      ? "demo_class"
      : application.status;
    const history = nextStatus !== application.status
      ? [...(application.statusHistory || []), { status: nextStatus, at: new Date().toISOString(), by: req.userData.name }]
      : application.statusHistory;

    const updated = db.findByIdAndUpdate("facultyApplications", req.params.id, { demoEvaluation, status: nextStatus, statusHistory: history });

    logAudit(req, "edit", "faculty-application", req.params.id, `Demo class evaluated for ${application.fullName}`);

    res.json({ success: true, data: updated, message: "Demo evaluation recorded" });
  } catch (error) {
    logger.error(`${req.method} ${req.originalUrl} failed: ${error.message}`, { stack: error.stack });
    res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
  }
});

// ============================================================
// File downloads — resume / photo / demo video (single) and
// certificates/:index (array). All private, admin-auth only.
// ============================================================
router.get("/:id/files/:field", requirePermission("recruitment:view"), async (req, res) => {
  const application = db.findById("facultyApplications", req.params.id);
  if (!application) return res.status(404).json({ success: false, message: "Application not found" });

  const { field } = req.params;
  if (["resume", "photo", "demoVideo"].includes(field)) {
    const file = application[field];
    if (!file) return res.status(404).json({ success: false, message: "File not found" });
    if (file.key) {
      return r2Service.streamToResponse(file.key, res, { downloadName: file.originalName });
    }
    return res.sendFile(path.join(FACULTY_APPLICATIONS_DIR, file.filename));
  }
  if (field === "certificate") {
    const idx = parseInt(req.query.index, 10) || 0;
    const file = (application.certificates || [])[idx];
    if (!file) return res.status(404).json({ success: false, message: "Certificate not found" });
    if (file.key) {
      return r2Service.streamToResponse(file.key, res, { downloadName: file.originalName });
    }
    return res.sendFile(path.join(FACULTY_APPLICATIONS_DIR, file.filename));
  }
  res.status(400).json({ success: false, message: "Unknown file field" });
});

module.exports = router;