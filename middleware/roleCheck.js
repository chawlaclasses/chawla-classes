const roleCheck = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. ${allowedRoles.join(' or ')} role required.`
      });
    }

    next();
  };
};

// Specific role checks for convenience
const isAdmin = roleCheck('admin');
const isStudent = roleCheck('student');
const isTeacher = roleCheck('teacher');
const isAdminOrTeacher = roleCheck('admin', 'teacher');

module.exports = {
  roleCheck,
  isAdmin,
  isStudent,
  isTeacher,
  isAdminOrTeacher
};