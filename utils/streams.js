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
  const subjectStream = subject && subject.stream ? subject.stream : '';
  if (!subjectStream) return true;
  return subjectStream === (student && student.stream ? student.stream : '');
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
};
