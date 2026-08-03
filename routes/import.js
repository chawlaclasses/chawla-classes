const express = require('express');
const router = express.Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');
const db = require('../services/jsonDb');
const { logAudit } = require('../utils/auditLog');
const { recordQuestionHistory } = require('../utils/questionHistory');
const logger = require('../utils/logger');

// FIX: this route used to run a home-grown, line-by-line extractQuestions()
// (below) directly on raw, unprocessed PDF text for every PDF import. It had
// none of the OCR/CID-garble filtering, ₹-symbol repair, or table handling
// that the real parser (parser/) already implements and that
// controllers/pdfController.js already uses correctly for the /api/pdf-data
// routes. Since the admin dashboard's "Import Questions" button actually
// posts to /api/import/questions (this file), PDFs with currency values —
// virtually all Commerce/Accounts papers — came out with the rupee symbol
// mangled into a bare "<" and the digits after it silently dropped (a common
// embedded-subset-font issue pdf-parse can't decode), producing MCQs with
// empty options and an empty correct answer that still got saved and marked
// isActive. Routing PDF imports through the real parser fixes this.
const { parseQuestionsFromText } = require('../parser');

// Adapts the real parser's output shape ({question, type: "MCQ"/"CaseStudy"/
// "Subjective", options: [string], answer, marks, ...}) to the legacy shape
// the rest of this file (and the DB-insert loop below) already expects
// ({questionText, options: [{label,text,isCorrect}], correctAnswer, type}).
function mapParsedToLegacyShape(parsedQuestions, chapter) {
    const TYPE_MAP = { MCQ: 'mcq', CaseStudy: 'case-study', Subjective: 'subjective' };
    const LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];
    return parsedQuestions.map((q, i) => ({
        questionText: q.question,
        options: (q.options || []).map((text, idx) => ({
            label: LABELS[idx] || String(idx + 1),
            text,
            isCorrect: false, // real parser can't infer the answer key from raw exam PDFs — left for admin review, same as before
        })),
        correctAnswer: '',
        questionNumber: i + 1,
        type: TYPE_MAP[q.type] || 'subjective',
        chapter: q.chapter || chapter || 'Uncategorized',
    }));
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype === 'application/msword') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF, DOCX, and TXT files are allowed'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// ============================================================
// Extract questions from text
// ============================================================
function extractQuestions(text, chapter) {
    const questions = [];
    const lines = text.split('\n').filter(line => line.trim());
    
    let currentQuestion = null;
    let currentOptions = [];
    let isCollectingOptions = false;
    let questionNumber = 0;
    let questionType = 'mcq';
    let answer = '';
    
    const questionNumberPattern = /^(\d+)[\.\)]\s*/;
    const optionPattern = /^([A-Da-d])[\.\)]\s*/;
    const answerPattern = /^Answer:\s*([A-Da-d])/i;
    const trueFalsePattern = /^(True|False|true|false)/;
    const fillBlankPattern = /^_{3,}|_{2,}/;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const qMatch = line.match(questionNumberPattern);
        if (qMatch) {
            if (currentQuestion) {
                if (currentOptions.length > 0) {
                    questionType = 'mcq';
                } else if (line.match(trueFalsePattern)) {
                    questionType = 'true-false';
                } else if (line.match(fillBlankPattern)) {
                    questionType = 'fill-in-blank';
                } else {
                    questionType = 'subjective';
                }
                
                let answer = '';
                for (let j = 0; j < currentOptions.length; j++) {
                    if (currentOptions[j].isCorrect) {
                        answer = currentOptions[j].text;
                        break;
                    }
                }
                
                questions.push({
                    questionText: currentQuestion,
                    options: currentOptions,
                    correctAnswer: answer,
                    questionNumber: questionNumber,
                    type: questionType,
                    chapter: chapter || 'Uncategorized'
                });
            }
            
            questionNumber = parseInt(qMatch[1]);
            currentQuestion = line.replace(questionNumberPattern, '').trim();
            currentOptions = [];
            isCollectingOptions = false;
            continue;
        }
        
        const optMatch = line.match(optionPattern);
        if (optMatch) {
            isCollectingOptions = true;
            const label = optMatch[1];
            const text = line.replace(optionPattern, '').trim();
            const isCorrect = text.includes('*') || text.includes('✅') || text.includes('correct');
            const cleanText = text.replace(/[*✅]/g, '').trim();
            
            currentOptions.push({
                label: label.toUpperCase(),
                text: cleanText,
                isCorrect: isCorrect
            });
            continue;
        }
        
        const ansMatch = line.match(answerPattern);
        if (ansMatch) {
            answer = ansMatch[1].toUpperCase();
            for (let opt of currentOptions) {
                if (opt.label === answer) {
                    opt.isCorrect = true;
                }
            }
            continue;
        }
        
        if (line.match(trueFalsePattern) && currentQuestion) {
            questionType = 'true-false';
            const isTrue = line.toLowerCase().includes('true');
            currentOptions = [
                { label: 'A', text: 'True', isCorrect: isTrue },
                { label: 'B', text: 'False', isCorrect: !isTrue }
            ];
            continue;
        }
        
        if (line.match(fillBlankPattern) && currentQuestion) {
            questionType = 'fill-in-blank';
            continue;
        }
        
        const answerKeyPattern = /^(\d+)\s*[-:]\s*([A-Da-d])/;
        const keyMatch = line.match(answerKeyPattern);
        if (keyMatch) {
            const qNum = parseInt(keyMatch[1]);
            const ans = keyMatch[2].toUpperCase();
            for (let q of questions) {
                if (q.questionNumber === qNum) {
                    for (let opt of q.options) {
                        opt.isCorrect = (opt.label === ans);
                    }
                    q.correctAnswer = ans;
                }
            }
            continue;
        }
        
        if (currentQuestion) {
            if (isCollectingOptions) {
                currentQuestion += ' ' + line;
            } else {
                if (line.length > 0 && !line.match(/^\d/)) {
                    currentQuestion += ' ' + line;
                }
            }
        }
    }
    
    if (currentQuestion) {
        if (currentOptions.length > 0) {
            questionType = 'mcq';
        } else if (currentQuestion.match(trueFalsePattern)) {
            questionType = 'true-false';
        } else if (currentQuestion.match(fillBlankPattern)) {
            questionType = 'fill-in-blank';
        } else {
            questionType = 'subjective';
        }
        
        let answer = '';
        for (let j = 0; j < currentOptions.length; j++) {
            if (currentOptions[j].isCorrect) {
                answer = currentOptions[j].text;
                break;
            }
        }
        
        questions.push({
            questionText: currentQuestion,
            options: currentOptions,
            correctAnswer: answer,
            questionNumber: questionNumber,
            type: questionType,
            chapter: chapter || 'Uncategorized'
        });
    }
    
    return questions;
}

// ============================================================
// Detect tables in text
// ============================================================
function detectTables(text) {
    const tables = [];
    const lines = text.split('\n');
    let currentTable = [];
    let inTable = false;
    
    for (let line of lines) {
        const hasMultipleColumns = (line.match(/\|/g) || []).length >= 2;
        const hasSpacedColumns = line.split(/\s{2,}/).length >= 3;
        
        if (hasMultipleColumns || hasSpacedColumns) {
            inTable = true;
            currentTable.push(line.trim());
        } else if (inTable && line.trim() === '') {
            if (currentTable.length > 0) {
                tables.push(currentTable.join('\n'));
                currentTable = [];
                inTable = false;
            }
        }
    }
    
    if (currentTable.length > 0) {
        tables.push(currentTable.join('\n'));
    }
    
    return tables;
}

// ============================================================
// Detect images in text
// ============================================================
function detectImages(text) {
    const images = [];
    const base64Pattern = /data:image\/(png|jpeg|jpg|gif|svg);base64,[^\s]+/g;
    const urlPattern = /https?:\/\/[^\s]+\.(png|jpg|jpeg|gif|svg)/gi;
    
    const base64Matches = text.match(base64Pattern) || [];
    const urlMatches = text.match(urlPattern) || [];
    
    return [...base64Matches, ...urlMatches];
}

// ============================================================
// Process PDF file with better error handling
// ============================================================
// ============================================================
// Process PDF file with multiple fallback methods
// ============================================================
async function processPDF(filePath, chapter) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        let text = '';
        
        // Method 1: Try with pdf-parse with options
        try {
            const pdfData = await pdfParse(dataBuffer, {
                max: 0, // All pages
                pagerender: function(pageData) {
                    return pageData.getTextContent().then(function(textContent) {
                        let lastY, text = '';
                        for (let item of textContent.items) {
                            if (lastY !== item.transform[5]) {
                                text += '\n';
                            }
                            text += item.str;
                            lastY = item.transform[5];
                        }
                        return text;
                    });
                }
            });
            text = pdfData.text;
            logger.info('PDF parsed successfully with custom renderer');
        } catch (err1) {
            logger.info('Custom renderer failed, trying default parser...');
            
            // Method 2: Try with default pdf-parse
            try {
                const pdfData = await pdfParse(dataBuffer);
                text = pdfData.text;
                logger.info('PDF parsed successfully with default parser');
            } catch (err2) {
                logger.info('Default parser failed, trying fallback...');
                
                // Method 3: Try with different approach - extract raw text
                try {
                    // Remove invalid characters
                    const cleanBuffer = dataBuffer.toString('utf8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
                    const lines = cleanBuffer.split('\n').filter(line => line.trim().length > 0);
                    text = lines.join('\n');
                    logger.info('PDF parsed using fallback method');
                } catch (err3) {
                    throw new Error('Unable to parse PDF file. Please ensure it\'s a valid text-based PDF.');
                }
            }
        }
        
        // If text is empty, try one more method
        if (!text || text.length < 10) {
            logger.info('Text extraction failed, trying alternative...');
            try {
                const pdfData = await pdfParse(dataBuffer);
                text = pdfData.text;
            } catch (err) {
                // Use raw extraction as last resort
                const content = dataBuffer.toString('utf8');
                const lines = content.split('\n').filter(line => {
                    return line.trim().length > 20 && !line.includes('%PDF') && !line.includes('endobj');
                });
                text = lines.join('\n');
            }
        }
        
        // FIX: was extractQuestions(text, chapter) — the naive scanner with
        // no OCR/₹/table handling. See note above the import at the top of
        // this file for why that broke Commerce/Accounts PDF imports.
        const parsed = parseQuestionsFromText(text, { chapter });
        const questions = mapParsedToLegacyShape(parsed, chapter);
        const tables = detectTables(text);
        const images = detectImages(text);
        
        return {
            success: true,
            questions: questions,
            tables: tables,
            images: images,
            totalQuestions: questions.length,
            text: text
        };
    } catch (error) {
        logger.error('PDF processing error:', error);
        return {
            success: false,
            error: 'Failed to process PDF file. Please ensure it\'s a valid PDF with text content.'
        };
    }
}

// ============================================================
// Process DOCX file
// ============================================================
async function processDOCX(filePath, chapter) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const result = await mammoth.extractRawText({ buffer: dataBuffer });
        const text = result.value;
        
        const parsed = parseQuestionsFromText(text, { chapter });
        const questions = mapParsedToLegacyShape(parsed, chapter);
        const tables = detectTables(text);
        const images = detectImages(text);
        
        return {
            success: true,
            questions: questions,
            tables: tables,
            images: images,
            totalQuestions: questions.length,
            text: text
        };
    } catch (error) {
        logger.error('DOCX processing error:', error);
        return {
            success: false,
            error: 'Failed to process DOCX file. Please ensure it\'s a valid Word document.'
        };
    }
}

// ============================================================
// Process TXT file
// ============================================================
async function processTXT(filePath, chapter) {
    try {
        const text = fs.readFileSync(filePath, 'utf8');
        
        const parsed = parseQuestionsFromText(text, { chapter });
        const questions = mapParsedToLegacyShape(parsed, chapter);
        const tables = detectTables(text);
        const images = detectImages(text);
        
        return {
            success: true,
            questions: questions,
            tables: tables,
            images: images,
            totalQuestions: questions.length,
            text: text
        };
    } catch (error) {
        logger.error('TXT processing error:', error);
        return {
            success: false,
            error: 'Failed to process TXT file. Please ensure it\'s a valid text file.'
        };
    }
}

// ============================================================
// Import API Route
// ============================================================
router.post('/questions', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        
        const chapter = req.body.chapter || 'Imported Questions';
        const filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();

        // Optional subject tagging — if the admin picked a subject for this
        // import batch, every question extracted from the file gets tagged
        // with it (and its class, derived the same way as the manual
        // create/edit routes in routes/admin/question-bank.js). Left
        // untagged (null) if no subject was chosen — those show up under
        // "Unassigned" in the Question Bank's subject filter.
        let importSubjectId = null;
        let importClassId = null;
        if (req.body.subjectId) {
          const subject = db.findById('subjects', req.body.subjectId);
          if (!subject) {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            return res.status(400).json({ success: false, message: 'Selected subject was not found' });
          }
          importSubjectId = subject._id;
          importClassId = subject.classId || null;
        }
        
        let result;
        
        switch(fileExt) {
            case '.pdf':
                result = await processPDF(filePath, chapter);
                break;
            case '.docx':
                result = await processDOCX(filePath, chapter);
                break;
            case '.txt':
                result = await processTXT(filePath, chapter);
                break;
            default:
                fs.unlinkSync(filePath);
                return res.status(400).json({
                    success: false,
                    message: 'Unsupported file format. Please upload PDF, DOCX, or TXT.'
                });
        }
        
        // Clean up uploaded file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to process file',
                error: result.error
            });
        }
        
        if (result.questions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No questions found in the file. Please check the format.'
            });
        }
        
        const savedQuestions = [];
        for (const q of result.questions) {
            const saved = db.insertOne('questions', {
                questionText: q.questionText,
                chapter: q.chapter,
                subjectId: importSubjectId,
                classId: importClassId,
                options: q.options.map(opt => ({
                    text: opt.text,
                    isCorrect: opt.isCorrect || false
                })),
                correctAnswer: q.correctAnswer || '',
                marks: 1,
                type: q.type || 'mcq',
                difficulty: 'medium', // can't reliably auto-detect difficulty from PDF text — flag for review via the status:'draft' workflow instead
                status: 'draft', // imported content always starts as Draft — needs review before publishing, same as manually-created questions
                isActive: true, // matches manually-created questions (routes/adminRoutes.js POST /questions) — isActive is a soft-delete flag, not a review gate; see the fix at the auto-generate-test pool query for the actual Draft-leak fix
                createdBy: req.user?.id || 'admin',
                imported: true,
                importDate: new Date().toISOString()
            });
            recordQuestionHistory(req, saved._id, 'created', { toStatus: 'draft', summary: `Imported from ${req.file.originalname}` });
            savedQuestions.push(saved);
        }
        
        logAudit(req, 'import', 'question', null, `Imported ${savedQuestions.length} question(s) from ${req.file.originalname} into "${chapter}"`);
        
        res.json({
            success: true,
            message: `Successfully imported ${savedQuestions.length} questions`,
            data: {
                totalQuestions: savedQuestions.length,
                questions: savedQuestions,
                tables: result.tables || [],
                images: result.images || [],
                preview: result.text ? result.text.substring(0, 500) : ''
            }
        });
        
    } catch (error) {
        logger.error('Import error:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'Failed to import questions'
        });
    }
});

// ============================================================
// Get import preview
// ============================================================
// ============================================================
// Get import preview - Updated PDF handling
// ============================================================
router.post('/preview', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'No file uploaded'
            });
        }
        
        const filePath = req.file.path;
        const fileExt = path.extname(req.file.originalname).toLowerCase();
        
        let result;
        
        switch(fileExt) {
            case '.pdf':
                try {
                    const dataBuffer = fs.readFileSync(filePath);
                    let text = '';
                    
                    try {
                        const pdfData = await pdfParse(dataBuffer);
                        text = pdfData.text;
                    } catch (pdfError) {
                        logger.info('PDF preview parse error, trying fallback...');
                        // Fallback: extract text from raw buffer
                        const content = dataBuffer.toString('utf8');
                        const lines = content.split('\n').filter(line => {
                            return line.trim().length > 20 && 
                                   !line.includes('%PDF') && 
                                   !line.includes('endobj') &&
                                   !line.includes('endstream');
                        });
                        text = lines.join('\n');
                    }
                    
                    result = { text: text, success: true };
                } catch (error) {
                    logger.error('PDF preview error:', error);
                    result = { success: false, error: 'Failed to read PDF. Please ensure it\'s a valid PDF file.' };
                }
                break;
            case '.docx':
                try {
                    const docxResult = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
                    result = { text: docxResult.value, success: true };
                } catch (docxError) {
                    logger.error('DOCX preview error:', docxError);
                    result = { success: false, error: 'Failed to read DOCX file.' };
                }
                break;
            case '.txt':
                try {
                    result = { text: fs.readFileSync(filePath, 'utf8'), success: true };
                } catch (txtError) {
                    logger.error('TXT preview error:', txtError);
                    result = { success: false, error: 'Failed to read TXT file.' };
                }
                break;
            default:
                fs.unlinkSync(filePath);
                return res.status(400).json({
                    success: false,
                    message: 'Unsupported file format. Please upload PDF, DOCX, or TXT.'
                });
        }
        
        // Clean up uploaded file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error
            });
        }
        
        const questions = extractQuestions(result.text, req.body.chapter || 'Preview');
        const tables = detectTables(result.text);
        const images = detectImages(result.text);
        
        res.json({
            success: true,
            data: {
                preview: result.text.substring(0, 1000),
                totalQuestions: questions.length,
                detectedQuestions: questions.slice(0, 10),
                tables: tables,
                images: images,
                fullText: result.text
            }
        });
        
    } catch (error) {
        logger.error('Preview error:', error);
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            message: 'Failed to preview file'
        });
    }
});

module.exports = router;