/**
 * Jest test environment setup
 * Runs before all tests
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.JWT_SECRET = 'test-secret-key-12345';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';

// Mock console.error to reduce test output noise
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('listen') || args[0].includes('already in use'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Global test helpers
global.testUser = {
  id: 'test-user-1',
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin'
};

global.testStudent = {
  id: 'test-student-1',
  name: 'Test Student',
  rollNumber: 'TS001',
  email: 'student@example.com',
  role: 'student'
};
