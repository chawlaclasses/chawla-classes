const db = require('../../services/jsonDb');

const getClasses = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', isActive } = req.query;
    
    let query = {};
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    let classes = db.find('classes', query);
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      classes = classes.filter(c => 
        searchRegex.test(c.name) || searchRegex.test(c.displayName)
      );
    }
    
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = classes.slice(start, end);
    const total = classes.length;
    
    const populatedData = paginatedData.map(c => {
      const subjects = db.find('subjects', { classId: c._id });
      return { ...c, subjects };
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
    console.error('Error getting classes:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving classes',
      error: error.message
    });
  }
};

const getClassById = async (req, res) => {
  try {
    const { id } = req.params;
    const classData = db.findById('classes', id);
    
    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }
    
    const subjects = db.find('subjects', { classId: id });
    
    res.json({
      success: true,
      data: { ...classData, subjects }
    });
  } catch (error) {
    console.error('Error getting class:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving class',
      error: error.message
    });
  }
};

const createClass = async (req, res) => {
  try {
    const { name, displayName, description } = req.body;
    
    const existing = db.findOne('classes', { name });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Class with this name already exists'
      });
    }
    
    const newClass = db.insertOne('classes', {
      name,
      displayName,
      description,
      subjects: [],
      isActive: true,
      createdBy: req.user.id
    });
    
    res.status(201).json({
      success: true,
      data: newClass,
      message: 'Class created successfully'
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating class',
      error: error.message
    });
  }
};

const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, displayName, description, isActive } = req.body;
    
    const existing = db.findById('classes', id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }
    
    if (name && name !== existing.name) {
      const duplicate = db.findOne('classes', { name });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'Class with this name already exists'
        });
      }
    }
    
    const updated = db.findByIdAndUpdate('classes', id, {
      name: name || existing.name,
      displayName: displayName || existing.displayName,
      description: description !== undefined ? description : existing.description,
      isActive: isActive !== undefined ? isActive : existing.isActive
    });
    
    res.json({
      success: true,
      data: updated,
      message: 'Class updated successfully'
    });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating class',
      error: error.message
    });
  }
};

const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;
    
    const existing = db.findById('classes', id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }
    
    const subjects = db.find('subjects', { classId: id });
    if (subjects.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete class with existing subjects'
      });
    }
    
    db.findByIdAndDelete('classes', id);
    
    res.json({
      success: true,
      message: 'Class deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting class',
      error: error.message
    });
  }
};

module.exports = {
  getClasses,
  getClassById,
  createClass,
  updateClass,
  deleteClass
};