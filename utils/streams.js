// utils/streams.js
//
// Stream support (Science / Commerce / Arts) for Class 11-12 style classes.
//
// Data model (all fields optional, so existing data keeps working untouched):
//   class.streams   -> array of streams this class offers, e.g. ['Science','Commerce','Arts'].
//                      Empty / missing = class has no streams (Class 9, 10).
//   subject.stream  -> '' (common to every stream, e.g. English) or one stream name.
//   user.stream     -> student's stream. '' when their class has no streams.

const STREAMS = ['Science', 'Commerce', 'Arts'];

// Accepts anything (array, undefined, junk) and returns a clean, de-duplicated
// array containing only known streams, in canonical order.
function normalizeStreams(input) {
  if (!Array.isArray(input)) return [];
  const set = new Set(input.map(s => String(s).trim().toLowerCase()));
  return STREAMS.filter(s => set.has(s.toLowerCase()));
}

// Canonicalises a single stream value ('science' -> 'Science'); '' if unknown/blank.
function normalizeStream(value) {
  if (value === undefined || value === null) return '';
  const v = String(value).trim().toLowerCase();
  return STREAMS.find(s => s.toLowerCase() === v) || '';
}

function classHasStreams(cls) {
  return !!cls && Array.isArray(cls.streams) && cls.streams.length > 0;
}

// Validates a stream value against a class. Returns { ok, stream, message }.
//   - class has streams: stream is required and must be one the class offers
//   - class has no streams (or no class): stream is forced to ''
function resolveStudentStream(cls, rawStream) {
  if (!classHasStreams(cls)) return { ok: true, stream: '' };
  const stream = normalizeStream(rawStream);
  if (!stream) {
    return { ok: false, message: `Please select a stream for ${cls.displayName || cls.name} (${cls.streams.join(' / ')})` };
  }
  if (!cls.streams.includes(stream)) {
    return { ok: false, message: `${cls.displayName || cls.name} does not offer the ${stream} stream` };
  }
  return { ok: true, stream };
}

// Subjects a student should see: common subjects (no stream) + their own stream.
// Students in a class without streams only ever see stream-less subjects, which
// is every subject in practice, so Class 9/10 behaviour is unchanged.
function subjectVisibleToStudent(subject, student) {
  // Subject enrollment: if the admin picked specific subjects for this
  // student (student.subjectIds non-empty), only those are visible.
  // Empty / missing = enrolled in every subject of the class (the old
  // behaviour, so existing students are unaffected).
  const enrolled = student && Array.isArray(student.subjectIds) ? student.subjectIds : [];
  if (enrolled.length > 0 && subject && !enrolled.includes(subject._id)) return false;

  const subjectStream = subject && subject.stream ? subject.stream : '';
  if (!subjectStream) return true;
  return subjectStream === (student && student.stream ? student.stream : '');
}

// Validates a list of subject ids chosen for a student against their class
// (and stream). Returns { ok, subjectIds, message }. Empty list is valid
// and means "all subjects of the class".
function resolveStudentSubjects(subjectsOfClass, student, rawIds) {
  if (rawIds === undefined || rawIds === null) return { ok: true, subjectIds: [] };
  if (!Array.isArray(rawIds)) return { ok: false, message: 'subjectIds must be an array' };
  const ids = [...new Set(rawIds.map(String))];
  const allowed = new Map((subjectsOfClass || []).map(sub => [String(sub._id), sub]));
  for (const id of ids) {
    const sub = allowed.get(id);
    if (!sub) return { ok: false, message: 'One or more selected subjects do not belong to this class' };
    const subStream = sub.stream || '';
    if (subStream && subStream !== ((student && student.stream) || '')) {
      return { ok: false, message: `${sub.name} is not part of the selected stream` };
    }
  }
  return { ok: true, subjectIds: ids };
}

function filterSubjectsForStudent(subjects, student) {
  return (subjects || []).filter(s => subjectVisibleToStudent(s, student));
}

module.exports = {
  STREAMS,
  normalizeStreams,
  normalizeStream,
  classHasStreams,
  resolveStudentStream,
  subjectVisibleToStudent,
  filterSubjectsForStudent,
  resolveStudentSubjects,
};
