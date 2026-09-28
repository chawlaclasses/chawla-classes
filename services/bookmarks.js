// services/bookmarks.js
"use strict";

const db = require('./jsonDb');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class BookmarkService {
    constructor() {
        this.collection = 'bookmarks';
    }

    async addBookmark(studentId, questionId, category = 'default') {
        // Check if already bookmarked
        const existing = await db.findOne(this.collection, {
            studentId,
            questionId
        });

        if (existing) {
            // Toggle: remove if exists
            await db.deleteById(this.collection, existing.id);
            return { action: 'removed', message: 'Bookmark removed' };
        }

        // Get question details (real question bank docs use `id`, not `_id`)
        const question = await db.findOne('questions', { id: questionId });
        if (!question) throw new Error('Question not found');

        const bookmark = {
            id: uuidv4(),
            studentId,
            questionId,
            subject: question.subject,   // top-level, for filtering (see getBookmarks)
            chapter: question.chapter,   // top-level, for filtering
            question: {
                text: question.question, // question bank stores text as `question`
                subject: question.subject,
                chapter: question.chapter,
                type: question.type,
                difficulty: question.difficulty || null // not tracked by the question bank today
            },
            category,
            notes: '',
            createdAt: new Date().toISOString(),
            lastReviewed: null,
            reviewCount: 0
        };

        await db.insert(this.collection, bookmark);
        return { action: 'added', message: 'Bookmark added', bookmark };
    }

    async removeBookmark(studentId, questionId) {
        const bookmark = await db.findOne(this.collection, {
            studentId,
            questionId
        });

        if (!bookmark) throw new Error('Bookmark not found');
        
        await db.deleteById(this.collection, bookmark.id);
        return { success: true };
    }

    async getBookmarks(studentId, filters = {}) {
        const query = { studentId };
        
        if (filters.category) query.category = filters.category;
        
        let bookmarks = await db.find(this.collection, query, {
            sort: 'createdAt:desc'
        });

        if (filters.subject) {
            bookmarks = bookmarks.filter(b => (b.subject || b.question?.subject) === filters.subject);
        }

        return bookmarks.slice(0, filters.limit || 50);
    }

    async getBookmarkedQuestions(studentId, filters = {}) {
        const bookmarks = await this.getBookmarks(studentId, filters);
        const questionIds = bookmarks.map(b => b.questionId);
        
        const questions = await db.find('questions', {
            id: { $in: questionIds }
        });

        return questions;
    }

    async updateBookmarkCategory(studentId, questionId, newCategory) {
        const bookmark = await db.findOne(this.collection, {
            studentId,
            questionId
        });

        if (!bookmark) throw new Error('Bookmark not found');

        bookmark.category = newCategory;
        await db.updateById(this.collection, bookmark.id, bookmark);
        return bookmark;
    }

    async addNote(studentId, questionId, note) {
        const bookmark = await db.findOne(this.collection, {
            studentId,
            questionId
        });

        if (!bookmark) throw new Error('Bookmark not found');

        bookmark.notes = note;
        await db.updateById(this.collection, bookmark.id, bookmark);
        return bookmark;
    }

    async reviewBookmark(studentId, questionId) {
        const bookmark = await db.findOne(this.collection, {
            studentId,
            questionId
        });

        if (!bookmark) throw new Error('Bookmark not found');

        bookmark.lastReviewed = new Date().toISOString();
        bookmark.reviewCount++;
        await db.updateById(this.collection, bookmark.id, bookmark);
        return bookmark;
    }

    async getCategories(studentId) {
        const bookmarks = await db.find(this.collection, { studentId });
        const categories = new Set();
        bookmarks.forEach(b => categories.add(b.category));
        return Array.from(categories);
    }

    async exportBookmarks(studentId, format = 'json') {
        const bookmarks = await db.find(this.collection, { studentId });
        
        if (format === 'json') {
            return bookmarks;
        } else if (format === 'csv') {
            // Convert to CSV
            const headers = ['Question', 'Subject', 'Chapter', 'Category', 'Created At'];
            const rows = bookmarks.map(b => [
                b.question.text,
                b.question.subject,
                b.question.chapter,
                b.category,
                b.createdAt
            ]);
            return { headers, rows };
        }
    }
}

module.exports = new BookmarkService();