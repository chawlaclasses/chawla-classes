const db = require('../../services/jsonDb');

const getSubjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', classId, isActive } = req.query;
    
    let query = {};
    if (classId) query.classId = classId;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    let subjects = db.find('subjects', query);
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      subjects = subjects.filter(s => 
        searchRegex.test(s.name) || searchRegex.test(s.code)
      );
    }
    
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = subjects.slice(start, end);
    const total = subjects.length;
    
    const populatedData = paginatedData.map(s => {
      const classData = db.findById('classes', s.classId);
      return { ...s, classId: classData };
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
    console.error('Error getting subjects:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subjects',
      error: error.message
    });
  }
};

const getSubjectById = async (req, res) => {
  try {
    const { id } = req.params;
    const subject = db.findById('subjects', id);
    
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }
    
    const classData = db.findById('classes', subject.classId);
    const series = db.find('series', { subjectId: id });
    
    res.json({
      success: true,
      data: { ...subject, classId: classData, series }
    });
  } catch (error) {
    console.error('Error getting subject:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving subject',
      error: error.message
    });
  }
};

const createSubject = async (req, res) => {
  try {
    const { name, code, classId, description } = req.body;
    
    const classData = db.findById('classes', classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }
    
    const existing = db.findOne('subjects', { classId, name });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Subject with this name already exists in this class'
      });
    }
    
    const newSubject = db.insertOne('subjects', {
      name,
      code: code.toUpperCase(),
      classId,
      description,
      isActive: true,
      createdBy: req.user.id
    });
    
    // Add subject to class
    const classSubjects = classData.subjects || [];
    classSubjects.push(newSubject._id);
    db.findByIdAndUpdate('classes', classId, { subjects: classSubjects });
    
    res.status(201).json({
      success: true,
      data: newSubject,
      message: 'Subject created successfully'
    });
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating subject',
      error: error.message
    });
  }
};

const updateSubject = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, isActive } = req.body;
    
    const subject = db.findById('subjects', id);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }
    
    if (name && name !== subject.name) {
      const duplicate = db.findOne('subjects', { classId: subject.classId, name });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'Subject with this name already exists in this class'
        });
      }
    }
    
    const updated = db.findByIdAndUpdate('subjects', id, {
      name: name || subject.name,
      code: code ? code.toUpperCase() : subject.code,
      description: description !== undefined ? description : subject.description,
      isActive: isActive !== undefined ? isActive : subject.isActive
    });
    
    res.json({
      success: true,
      data: updated,
      message: 'Subject updated successfully'
    });
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating subject',
      error: error.message
    });
  }
};

const deleteSubject = async (req, res) => {
  try {
    const { id } = req.params;
    
    const subject = db.findById('subjects', id);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }
    
    const series = db.find('series', { subjectId: id });
    if (series.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete subject with existing series'
      });
    }
    
    // Remove subject from class
    const classData = db.findById('classes', subject.classId);
    if (classData) {
      const subjects = classData.subjects.filter(s => s !== id);
      db.findByIdAndUpdate('classes', subject.classId, { subjects });
    }
    
    db.findByIdAndDelete('subjects', id);
    
    res.json({
      success: true,
      message: 'Subject deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting subject',
      error: error.message
    });
  }
};

module.exports = {
  getSubjects,
  getSubjectById,
  createSubject,
  updateSubject,
  deleteSubject
};