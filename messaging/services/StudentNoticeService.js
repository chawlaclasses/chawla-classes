"use strict";
const { PURPOSES } = require("../constants");

/** Notice board -> SMS/WhatsApp. Built on a campaign so it gets preview, stats, cancel and queueing for free. */
class StudentNoticeService {
  constructor({ config, bulk }) { this.config = config; this.bulk = bulk; }

  /**
   * @param {{title,message,channel?,classId?,batch?,studentIds?,alsoParents?:boolean,launch?:boolean}} n
   */
  async publish(n, adminId) {
    const channel = n.channel || this.config.defaultChannel;
    const filter = { classId: n.classId, batch: n.batch, studentIds: n.studentIds };
    const out = [];
    const audiences = [{ kind: "students", templateKey: "student_notice", label: "students" }];
    if (n.alsoParents) audiences.push({ kind: "parents", templateKey: "parent_notice", label: "parents" });

    for (const a of audiences) {
      const c = await this.bulk.createCampaign({
        name: `Notice: ${n.title} → ${a.label}`, purpose: PURPOSES.NOTICE, channel, templateKey: a.templateKey,
        variables: { title: n.title, message: n.message }, audience: { kind: a.kind, filter },
      }, adminId);
      out.push(n.launch === false ? { campaignId: String(c._id), preview: await this.bulk.preview(c._id) } : await this.bulk.launch(c._id, adminId));
    }
    return out;
  }
}
module.exports = StudentNoticeService;
