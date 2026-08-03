const db = require('../../services/jsonDb');

const getSeries = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', subjectId, classId, type, isActive } = req.query;
    
    let query = {};
    if (subjectId) query.subjectId = subjectId;
    if (classId) query.classId = classId;
    if (type) query.type = type;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    
    let series = db.find('series', query);
    
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      series = series.filter(s => searchRegex.test(s.name));
    }
    
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedData = series.slice(start, end);
    const total = series.length;
    
    const populatedData = paginatedData.map(s => {
      const subject = db.findById('subjects', s.subjectId);
      const classData = db.findById('classes', s.classId);
      return { ...s, subjectId: subject, classId: classData };
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
    console.error('Error getting series:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving series',
      error: error.message
    });
  }
};

const createSeries = async (req, res) => {
  try {
    const { name, subjectId, classId, description, type } = req.body;
    
    const subject = db.findById('subjects', subjectId);
    if (!subject) {
      return res.status(404).json({
        success: false,
        message: 'Subject not found'
      });
    }
    
    const classData = db.findById('classes', classId);
    if (!classData) {
      return res.status(404).json({
        success: false,
        message: 'Class not found'
      });
    }
    
    const existing = db.findOne('series', { subjectId, name });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Series with this name already exists for this subject'
      });
    }
    
    const newSeries = db.insertOne('series', {
      name,
      subjectId,
      classId,
      description,
      type: type || 'other',
      isActive: true,
      createdBy: req.user.id
    });
    
    res.status(201).json({
      success: true,
      data: newSeries,
      message: 'Series created successfully'
    });
  } catch (error) {
    console.error('Error creating series:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating series',
      error: error.message
    });
  }
};

const updateSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, type, isActive } = req.body;
    
    const series = db.findById('series', id);
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    if (name && name !== series.name) {
      const duplicate = db.findOne('series', { subjectId: series.subjectId, name });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: 'Series with this name already exists for this subject'
        });
      }
    }
    
    const updated = db.findByIdAndUpdate('series', id, {
      name: name || series.name,
      description: description !== undefined ? description : series.description,
      type: type || series.type,
      isActive: isActive !== undefined ? isActive : series.isActive
    });
    
    res.json({
      success: true,
      data: updated,
      message: 'Series updated successfully'
    });
  } catch (error) {
    console.error('Error updating series:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating series',
      error: error.message
    });
  }
};

const deleteSeries = async (req, res) => {
  try {
    const { id } = req.params;
    
    const series = db.findById('series', id);
    if (!series) {
      return res.status(404).json({
        success: false,
        message: 'Series not found'
      });
    }
    
    const tests = db.find('tests', { seriesId: id });

// Delete all tests of this series
tests.forEach(test => {
  db.findByIdAndDelete('tests', test._id);
});
    
    db.findByIdAndDelete('series', id);
    
    res.json({
      success: true,
      message: 'Series deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting series:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting series',
      error: error.message
    });
  }
};

module.exports = {
  getSeries,
  createSeries,
  updateSeries,
  deleteSeries
};