// services/revision.js
"use strict";

const db = require('./jsonDb');

// Simple spaced-repetition schedule for bookmarks: how many days must pass
// since last review before it's due again, based on how many times it has
// already been reviewed. Never-reviewed bookmarks are always due.
const REVIEW_INTERVALS_DAYS = [0, 1, 3, 7, 14, 30];

function daysSince(isoDate) {
    if (!isoDate) return Infinity;
    return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24);
}

class RevisionService {
    async getQueue(studentId, limit = 20) {
        const [wrongPending, bookmarks] = await Promise.all([
            db.find('wrong_questions', { studentId, improved: false }),
            db.find('bookmarks', { studentId })
        ]);

        const items = [];

        // Wrong questions: higher miss count and longer since last attempt
        // both push priority up — these are the ones actively hurting the
        // student and getting stale.
        wrongPending.forEach(w => {
            const staleDays = daysSince(w.lastAttempted);
            items.push({
                questionId: w.questionId,
                source: 'wrong',
                subject: w.subject,
                chapter: w.chapter,
                text: w.question,
                reason: `Missed ${w.count}× · last attempted ${Math.floor(Math.min(staleDays, 999))}d ago`,
                priority: w.count * 10 + Math.min(staleDays, 30)
            });
        });

        // Bookmarks: due based on a simple spaced-repetition interval keyed
        // off how many times it's already been reviewed.
        bookmarks.forEach(b => {
            const reviewCount = b.reviewCount || 0;
            const intervalDays = REVIEW_INTERVALS_DAYS[Math.min(reviewCount, REVIEW_INTERVALS_DAYS.length - 1)];
            const sinceLastReview = daysSince(b.lastReviewed);
            const isDue = sinceLastReview >= intervalDays;

            if (!isDue) return;

            items.push({
                questionId: b.questionId,
                source: 'bookmark',
                subject: b.subject || b.question?.subject,
                chapter: b.chapter || b.question?.chapter,
                text: b.question?.text,
                reason: reviewCount === 0
                    ? 'Never reviewed'
                    : `Due for review · reviewed ${reviewCount}× before`,
                priority: reviewCount === 0 ? 50 : Math.min(sinceLastReview, 30)
            });
        });

        // A question can be both wrong AND bookmarked — keep the
        // higher-priority (wrong) entry and drop the duplicate.
        const seen = new Set();
        const deduped = items
            .sort((a, b) => b.priority - a.priority)
            .filter(item => {
                if (seen.has(item.questionId)) return false;
                seen.add(item.questionId);
                return true;
            });

        const queue = deduped.slice(0, limit);

        return {
            queue,
            totalDue: deduped.length,
            dueWrong: deduped.filter(i => i.source === 'wrong').length,
            dueBookmarks: deduped.filter(i => i.source === 'bookmark').length
        };
    }
}

module.exports = new RevisionService();