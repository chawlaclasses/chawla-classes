const db = require("../../services/jsonDb");

const getQuestions = async (req, res) => {
  try {
    const { testId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    
    const test = db.findById("tests", testId);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    let questions = db.find("testQuestions", { testId, isActive: true });
    
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = questions.slice(start, end);
    const total = questions.length;
    
    res.json({
      success: true,
      data: paginatedData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error getting questions:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving questions",
      error: error.message
    });
  }
};

const addQuestion = async (req, res) => {
  try {
    const { testId } = req.params;
    const { questionText, options, correctAnswer, explanation, marks, type } = req.body;
    
    const test = db.findById("tests", testId);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    const count = db.countDocuments("testQuestions", { testId });
    const order = count + 1;
    
    const newQuestion = db.insertOne("testQuestions", {
      testId,
      questionText,
      options,
      correctAnswer,
      explanation,
      marks: marks || 1,
      type: type || "mcq",
      order,
      isActive: true,
      createdBy: req.user.id
    });
    
    // Update test question count
    const updatedTest = db.findByIdAndUpdate("tests", testId, {
      totalQuestions: count + 1,
      questions: [...(test.questions || []), newQuestion._id]
    });
    
    res.status(201).json({
      success: true,
      data: newQuestion,
      message: "Question added successfully"
    });
  } catch (error) {
    console.error("Error adding question:", error);
    res.status(500).json({
      success: false,
      message: "Error adding question",
      error: error.message
    });
  }
};

const deleteQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    
    const question = db.findById("testQuestions", id);
    if (!question) {
      return res.status(404).json({ success: false, message: "Question not found" });
    }
    
    // Soft delete
    db.findByIdAndUpdate("testQuestions", id, { isActive: false });
    
    // Remove from test
    const test = db.findById("tests", question.testId);
    if (test) {
      const questions = test.questions.filter(q => q !== id);
      db.findByIdAndUpdate("tests", question.testId, {
        questions,
        totalQuestions: questions.length
      });
    }
    
    res.json({
      success: true,
      message: "Question deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting question:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting question",
      error: error.message
    });
  }
};

module.exports = {
  getQuestions,
  addQuestion,
  deleteQuestion
};