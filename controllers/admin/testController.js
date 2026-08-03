const db = require("../../services/jsonDb");

const getTests = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "", seriesId, subjectId, classId, isPublished } = req.query;
    
    let query = {};
    if (seriesId) query.seriesId = seriesId;
    if (subjectId) query.subjectId = subjectId;
    if (classId) query.classId = classId;
    if (isPublished !== undefined) query.isPublished = isPublished === "true";
    
    let tests = db.find("tests", query);
    
    if (search) {
      const searchRegex = new RegExp(search, "i");
      tests = tests.filter(t => searchRegex.test(t.title));
    }
    
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = tests.slice(start, end);
    const total = tests.length;
    
    const populatedData = paginatedData.map(t => {
      const series = db.findById("series", t.seriesId);
      const subject = db.findById("subjects", t.subjectId);
      const classData = db.findById("classes", t.classId);
      return { ...t, seriesId: series, subjectId: subject, classId: classData };
    });
    
    res.json({
      success: true,
      data: populatedData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error getting tests:", error);
    res.status(500).json({
      success: false,
      message: "Error retrieving tests",
      error: error.message
    });
  }
};

const createTest = async (req, res) => {
  try {
    const { title, description, seriesId, subjectId, classId, totalMarks, passingMarks, duration } = req.body;
    
    const series = db.findById("series", seriesId);
    if (!series) {
      return res.status(404).json({ success: false, message: "Series not found" });
    }
    
    const existing = db.findOne("tests", { seriesId, title });
    if (existing) {
      return res.status(409).json({ success: false, message: "Test with this title already exists in this series" });
    }
    
    const newTest = db.insertOne("tests", {
      title,
      description,
      seriesId,
      subjectId,
      classId,
      totalMarks,
      passingMarks,
      duration,
      negativeMarking: { enabled: false, value: 0 },
      maximumAttempts: 1,
      randomizeQuestions: false,
      randomizeOptions: false,
      isPublished: false,
      isScheduled: false,
      startDate: null,
      endDate: null,
      totalQuestions: 0,
      questions: [],
      createdBy: req.user.id,
      isDeleted: false
    });
    
    res.status(201).json({
      success: true,
      data: newTest,
      message: "Test created successfully"
    });
  } catch (error) {
    console.error("Error creating test:", error);
    res.status(500).json({
      success: false,
      message: "Error creating test",
      error: error.message
    });
  }
};

const updateTest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    const test = db.findById("tests", id);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    const updated = db.findByIdAndUpdate("tests", id, updateData);
    
    res.json({
      success: true,
      data: updated,
      message: "Test updated successfully"
    });
  } catch (error) {
    console.error("Error updating test:", error);
    res.status(500).json({
      success: false,
      message: "Error updating test",
      error: error.message
    });
  }
};

const deleteTest = async (req, res) => {
  try {
    const { id } = req.params;
    
    const test = db.findById("tests", id);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    db.findByIdAndDelete("tests", id);
    
    res.json({
      success: true,
      message: "Test deleted successfully"
    });
  } catch (error) {
    console.error("Error deleting test:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting test",
      error: error.message
    });
  }
};

const publishTest = async (req, res) => {
  try {
    const { id } = req.params;
    
    const test = db.findById("tests", id);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    const questions = db.find("testQuestions", { testId: id });
    if (questions.length === 0) {
      return res.status(400).json({ success: false, message: "Cannot publish test without questions" });
    }
    
    db.findByIdAndUpdate("tests", id, { isPublished: true });
    
    res.json({
      success: true,
      data: { isPublished: true },
      message: "Test published successfully"
    });
  } catch (error) {
    console.error("Error publishing test:", error);
    res.status(500).json({
      success: false,
      message: "Error publishing test",
      error: error.message
    });
  }
};

const unpublishTest = async (req, res) => {
  try {
    const { id } = req.params;
    
    const test = db.findById("tests", id);
    if (!test) {
      return res.status(404).json({ success: false, message: "Test not found" });
    }
    
    db.findByIdAndUpdate("tests", id, { isPublished: false });
    
    res.json({
      success: true,
      data: { isPublished: false },
      message: "Test unpublished successfully"
    });
  } catch (error) {
    console.error("Error unpublishing test:", error);
    res.status(500).json({
      success: false,
      message: "Error unpublishing test",
      error: error.message
    });
  }
};

module.exports = {
  getTests,
  createTest,
  updateTest,
  deleteTest,
  publishTest,
  unpublishTest
};