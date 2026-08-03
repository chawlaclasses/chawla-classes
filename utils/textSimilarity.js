/**
 * utils/textSimilarity.js
 *
 * Lightweight text similarity for duplicate-question detection. No
 * external NLP/embedding dependency — tokenizes into lowercase words
 * (punctuation stripped, very short/noise words dropped) and computes
 * Jaccard similarity over the two token sets. This is a fast, dependency-
 * free proxy for "these two questions are basically the same question
 * reworded" — good enough to flag candidates for a human to review; it is
 * NOT a semantic/ML similarity measure, so it will miss paraphrases that
 * share few literal words and can occasionally flag two unrelated
 * questions that happen to share a lot of common terminology (e.g. two
 * different quadratic-equation questions). That's why callers always
 * present matches for human Compare/Replace/Ignore rather than acting on
 * them automatically.
 */

"use strict";

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function jaccardSimilarity(textA, textB) {
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

module.exports = { jaccardSimilarity, tokenize };
