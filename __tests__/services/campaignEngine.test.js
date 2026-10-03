/**
 * Tests for the Recipient Selection System's engine layer:
 * services/recipientEngine.js, services/campaignChannels.js and
 * services/campaignEngine.js. jsonDb and the real senders are mocked, so no
 * SMS/email is ever sent and no data file is touched.
 */

'use strict';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/mailer', () => ({ sendMail: jest.fn(async () => ({ sent: true })) }));
jest.mock('../../utils/whatsapp', () => ({ sendWhatsApp: jest.fn(async () => ({ sent: true })) }));
jest.mock('../../utils/sms', () => ({
  // real normalisation rules, fake network
  normalizeNumber: (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length === 10) return d;
    if (d.length === 11 && d.startsWith('0')) return d.slice(1);
    if (d.length === 12 && d.startsWith('91')) return d.slice(2);
    return '';
  },
  sendSms: jest.fn(async () => ({ sent: true })),
}));

const mockData = {};
jest.mock('../../services/jsonDb', () => ({
  find: (collection, query = {}) =>
    (mockData[collection] || []).filter(d => Object.entries(query).every(([k, v]) => d[k] === v)),
}));
let mockCosts = { sms: 0.2, whatsapp: 0, email: 0 };
jest.mock('../../services/settings', () => ({ getSettings: () => ({ campaignCosts: mockCosts }) }));

const { sendSms } = require('../../utils/sms');
const recipientEngine = require('../../services/recipientEngine');
const { smsUnits } = require('../../services/campaignChannels');
const campaignEngine = require('../../services/campaignEngine');

function seed() {
  mockData.classes = [
    { _id: 'c9', name: 'Class 9', displayName: 'Class 9', isActive: true },
    { _id: 'c10', name: 'Class 10', displayName: 'Class 10', isActive: true },
    { _id: 'c11', name: 'Class 11', displayName: 'Class 11', streams: ['Commerce', 'Science'], isActive: true },
  ];
  mockData.users = [
    { _id: 's1', role: 'student', name: 'Aman', phone: '9876500001', parentName: 'Mr Gupta', parentPhone: '9876500101', classId: 'c9', isActive: true },
    { _id: 's2', role: 'student', name: 'Riya', phone: '9876500002', parentName: 'Mrs Sharma', parentPhone: '9876500102', classId: 'c10', isActive: true },
    // sibling of s2 — same parent number
    { _id: 's3', role: 'student', name: 'Rohan', phone: '9876500003', parentName: 'Mrs Sharma', parentPhone: '9876500102', classId: 'c10', isActive: true },
    { _id: 's4', role: 'student', name: 'Kabir', phone: '9876500004', parentPhone: '98765', classId: 'c11', stream: 'Commerce', isActive: true },
    { _id: 's5', role: 'student', name: 'Old Student', phone: '9876500005', classId: 'c9', isActive: false },
    { _id: 't1', role: 'teacher', name: 'Ms Verma', phone: '9876500201', assignedClasses: ['c11'], isActive: true },
  ];
  mockData['fees-v2'] = [{ _id: 'f1', studentId: 's1', status: 'Pending' }, { _id: 'f2', studentId: 's2', status: 'Paid' }];
  mockData.enquiries = [
    { _id: 'e1', name: 'Neha', phone: '9876500301', status: 'new', interestedClass: '11th Commerce' },
    { _id: 'e2', name: 'Old Lead', phone: '9876500302', status: 'closed', interestedClass: 'Class 10' },
  ];
}

beforeEach(() => { seed(); mockCosts = { sms: 0.2, whatsapp: 0, email: 0 }; sendSms.mockClear(); });

describe('normalizeClassKey', () => {
  test('matches class records, streams and free-text enquiry values to one key', () => {
    const k = recipientEngine.normalizeClassKey;
    expect(k('Class 11 Commerce')).toBe('11commerce');
    expect(k('11th Commerce')).toBe('11commerce');
    expect(k('Class 9th')).toBe('9');
    expect(k('Class 10')).toBe('10');
  });
});

describe('smsUnits', () => {
  test('160 GSM chars = 1 unit, 161 = 2 units (153 per part)', () => {
    expect(smsUnits('a'.repeat(160)).units).toBe(1);
    expect(smsUnits('a'.repeat(161)).units).toBe(2);
    expect(smsUnits('a'.repeat(306)).units).toBe(2);
    expect(smsUnits('a'.repeat(307)).units).toBe(3);
  });
  test('rupee sign / Hindi switch to Unicode (70 per SMS)', () => {
    const u = smsUnits('Fee ₹500 due');
    expect(u.encoding).toBe('Unicode');
    expect(smsUnits('न'.repeat(71)).units).toBe(2);
  });
  test('empty message = 0 units', () => {
    expect(smsUnits('').units).toBe(0);
  });
});

describe('meta / filters', () => {
  test('always offers the four required class filters, plus real classes', () => {
    const labels = recipientEngine.getMeta().classes.map(c => c.label);
    ['Class 9', 'Class 10', 'Class 11 Commerce', 'Class 12 Commerce'].forEach(l => expect(labels).toContain(l));
    expect(labels).toContain('Class 11 Science');
  });

  test('group counts', () => {
    const counts = Object.fromEntries(recipientEngine.getMeta().groups.map(g => [g.id, g.count]));
    expect(counts.all_students).toBe(5);
    expect(counts.active_students).toBe(4);
    expect(counts.fee_due).toBe(1);
    expect(counts.new_enquiries).toBe(1);
    expect(counts.teachers).toBe(1);
  });

  test('class filter narrows the pool (student stream + enquiry text + teacher assignment)', () => {
    const r = recipientEngine.listRecipients({ groups: 'custom', classKeys: '11commerce' });
    expect(r.rows.map(x => x.name).sort()).toEqual(['Kabir', 'Ms Verma', 'Neha', 'Parent of Kabir']);
  });

  test('search by name and by mobile (incl. parent mobile), status filter, pagination', () => {
    expect(recipientEngine.listRecipients({ groups: 'custom', search: 'aman' }).rows[0].name).toBe('Aman');
    expect(recipientEngine.listRecipients({ groups: 'custom', search: '9876500002' }).rows.map(r => r.key)).toContain('student:s2');
    expect(recipientEngine.listRecipients({ groups: 'custom', search: '9876500101' }).rows.map(r => r.key)).toContain('parent:s1');
    expect(recipientEngine.listRecipients({ groups: 'custom', status: 'Inactive' }).rows.map(r => r.name)).toEqual(['Old Student']);
    expect(recipientEngine.listRecipients({ groups: 'custom', status: 'Fee Due' }).rows.map(r => r.name)).toContain('Aman');
    const p = recipientEngine.listRecipients({ groups: 'custom', limit: 3, page: 2 });
    expect(p.rows).toHaveLength(3);
    expect(p.matchingKeys.length).toBe(p.total); // Select All covers other pages
  });

  test('a mixed query like "Aman 9" is a NAME search, not a phone fragment', () => {
    // "9" must not pull in every student whose number contains a 9
    expect(recipientEngine.listRecipients({ groups: 'custom', search: 'Aman 9' }).total).toBe(0);
    // numeric queries still work, with formatting characters
    expect(recipientEngine.listRecipients({ groups: 'custom', search: '+91 98765-00002' }).total).toBe(0); // 12-digit form isn't a substring of the stored 10-digit number
    expect(recipientEngine.listRecipients({ groups: 'custom', search: '98765 00002' }).rows.map(r => r.key)).toContain('student:s2');
  });

  test('no group ticked = empty table', () => {
    expect(recipientEngine.listRecipients({ groups: '' }).total).toBe(0);
  });
});

describe('resolveSelection', () => {
  test('auto groups select everyone; excluded removes; included only adds from the pool', () => {
    const keys = sel => recipientEngine.resolveSelection(sel).map(r => r.key).sort();
    expect(keys({ groups: ['fee_due'] })).toEqual(['student:s1']);
    expect(keys({ groups: ['active_students'], excluded: ['student:s1'] })).not.toContain('student:s1');
    // custom selects nobody on its own, only what is ticked
    expect(keys({ groups: ['custom'] })).toEqual([]);
    expect(keys({ groups: ['custom'], included: ['student:s2', 'teacher:t1', 'nope:1'] })).toEqual(['student:s2', 'teacher:t1']);
    // included outside the pool (class filter) is ignored
    expect(keys({ groups: ['custom'], classKeys: ['9'], included: ['student:s2'] })).toEqual([]);
  });

  test('garbage input does not throw', () => {
    expect(recipientEngine.resolveSelection(null)).toEqual([]);
    expect(recipientEngine.resolveSelection({ groups: 'bogus' })).toEqual([]);
  });
});

describe('buildPlan', () => {
  test('cost = SMS units x configurable rate', () => {
    const plan = campaignEngine.buildPlan({ channel: 'sms', message: 'Admissions open', selection: { groups: ['active_students'] } });
    expect(plan.selectedCount).toBe(4);
    expect(plan.validCount).toBe(4);
    expect(plan.totalUnits).toBe(4);
    expect(plan.rate).toBe(0.2);
    expect(plan.estimatedCost).toBe(0.8);

    mockCosts = { sms: 0.5, whatsapp: 0, email: 0 }; // changed in Admin Settings
    expect(campaignEngine.buildPlan({ channel: 'sms', message: 'Hi', selection: { groups: ['active_students'] } }).estimatedCost).toBe(2);
  });

  test('57 recipients x 1 unit x Rs 0.20 = Rs 11.40 (floating-point safe)', () => {
    mockData.users = Array.from({ length: 57 }, (_, i) => ({
      _id: `x${i}`, role: 'student', name: `S${i}`, phone: `98000${String(10000 + i)}`, classId: 'c9', isActive: true,
    }));
    const plan = campaignEngine.buildPlan({ channel: 'sms', message: 'Admissions open', selection: { groups: ['all_students'] } });
    expect(plan.validCount).toBe(57);
    expect(plan.totalUnits).toBe(57);
    expect(plan.estimatedCost).toBe(11.4);
  });

  test('long messages multiply units per recipient', () => {
    const plan = campaignEngine.buildPlan({ channel: 'sms', message: 'a'.repeat(200), selection: { groups: ['active_students'] } });
    expect(plan.totalUnits).toBe(4 * 2);
  });

  test('parents: one message per distinct number, invalid numbers counted', () => {
    const plan = campaignEngine.buildPlan({ channel: 'sms', message: 'Dear Parent', selection: { groups: ['parents'] } });
    expect(plan.selectedCount).toBe(4);   // s1, s2, s3, s4 parents
    expect(plan.duplicateCount).toBe(1);  // s2 + s3 share a parent number
    expect(plan.invalidCount).toBe(1);    // s4's parent number "98765"
    expect(plan.validCount).toBe(2);
  });

  test('placeholders are rendered per recipient; unknown ones are left visible', () => {
    const plan = campaignEngine.buildPlan({
      channel: 'sms', message: 'Hi {name}, {student} ({class}) {oops}', selection: { groups: ['fee_due'] },
    });
    expect(plan.sample.rendered).toBe('Hi Aman, Aman (Class 9) {oops}');
  });
});

describe('validatePlan', () => {
  const plan = (over = {}) => campaignEngine.buildPlan({ channel: 'sms', message: 'Hello', selection: { groups: ['active_students'] }, ...over });

  test('valid plan passes', () => {
    expect(campaignEngine.validatePlan(plan(), { title: 'x', requireTitle: true })).toBeNull();
  });
  test('empty / whitespace message is rejected', () => {
    expect(campaignEngine.validatePlan(plan({ message: '   ' }))).toMatch(/message cannot be empty/i);
  });
  test('no recipients selected is rejected', () => {
    expect(campaignEngine.validatePlan(plan({ selection: { groups: ['custom'] } }))).toMatch(/no recipients selected/i);
  });
  test('only invalid phone numbers is rejected', () => {
    const p = plan({ selection: { groups: ['custom'], included: ['parent:s4'] } });
    expect(p.selectedCount).toBe(1);
    expect(campaignEngine.validatePlan(p)).toMatch(/valid mobile number/i);
  });
  test('missing campaign name, unknown and unavailable channels', () => {
    expect(campaignEngine.validatePlan(plan(), { title: '  ', requireTitle: true })).toMatch(/campaign name/i);
    expect(campaignEngine.validatePlan(plan({ channel: 'carrier-pigeon' }))).toMatch(/valid channel/i);
    expect(campaignEngine.validatePlan(plan({ channel: 'push' }))).toMatch(/not available/i);
  });
  test('over-long message is rejected', () => {
    expect(campaignEngine.validatePlan(plan({ message: 'a'.repeat(1001) }))).toMatch(/too long/i);
  });
});

describe('executePlan', () => {
  test('counts successes and failures; only successful units are billed', async () => {
    sendSms.mockImplementation(async ({ to }) => (to === '9876500002' ? { sent: false, reason: 'DND number' } : { sent: true }));
    const p = campaignEngine.buildPlan({ channel: 'sms', message: 'Hello', selection: { groups: ['active_students'] } });
    const out = await campaignEngine.executePlan(p, { title: 't' });
    expect(out.sent).toBe(3);
    expect(out.failed).toBe(1);
    expect(out.failureReasons).toEqual({ 'DND number': 1 });
    expect(out.totalCost).toBe(0.6);
    sendSms.mockImplementation(async () => ({ sent: true }));
  });

  test('a sender that throws is counted as a failure, not a crash', async () => {
    sendSms.mockImplementationOnce(async () => { throw new Error('boom'); });
    const p = campaignEngine.buildPlan({ channel: 'sms', message: 'Hello', selection: { groups: ['fee_due'] } });
    const out = await campaignEngine.executePlan(p, { title: 't' });
    expect(out).toMatchObject({ sent: 0, failed: 1, failureReasons: { boom: 1 } });
  });

  test('message is sent exactly as rendered (no title prefix)', async () => {
    const p = campaignEngine.buildPlan({ channel: 'sms', message: 'Dear {name}', selection: { groups: ['fee_due'] } });
    await campaignEngine.executePlan(p, { title: 'Internal name' });
    expect(sendSms).toHaveBeenCalledWith({ to: '9876500001', body: 'Dear Aman' });
  });
});
