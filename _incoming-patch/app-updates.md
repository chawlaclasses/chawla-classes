/**
 * CRITICAL FIXES FOR app.js
 * 
 * This file shows the key sections that need to be added/updated in your app.js
 * to implement:
 * 1. CSRF Protection
 * 2. Enhanced Rate Limiting
 * 3. Error Tracking (Sentry)
 * 4. Session Management Improvements
 * 
 * HOW TO USE THIS FILE:
 * 1. Open your app.js
 * 2. Find each section below in your file
 * 3. Replace/add the code as shown
 */

// ═════════════════════════════════════════════════════════════
// 1. IMPORTS - ADD THESE AT THE TOP OF app.js
// ═════════════════════════════════════════════════════════════

// Add these imports with your existing ones:
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { initializeCsrfProtection, verifyCsrfToken, regenerateCsrfToken } = require('./middleware/csrfProtection');

// Sentry for error tracking (optional but recommended)
// npm install @sentry/node @sentry/tracing
const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

// ═════════════════════════════════════════════════════════════
// 2. SENTRY INITIALIZATION - ADD RIGHT AFTER IMPORTS
// ═════════════════════════════════════════════════════════════

if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1.0,
    profilesSampleRate: 0.1, // 10% of transactions
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ 
        request: true, 
        serverName: true, 
        transaction: true 
      }),
      nodeProfilingIntegration()
    ],
  });
}

// ═════════════════════════════════════════════════════════════
// 3. INSIDE createApp() FUNCTION - ADD EARLY (AFTER HELMET)
// ═════════════════════════════════════════════════════════════

function createApp() {
  const app = express();

  // Existing helmet setup...
  app.use(helmet({...}));

  // ───── NEW: Sentry request handler (must be early) ─────
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
  }

  // ───── NEW: Session middleware (before CSRF) ─────
  // In production, use Redis store instead of memory
  const sessionStore = process.env.REDIS_URL
    ? new (require('connect-redis').default)({ client: redisClient })
    : new (require('express-session').MemoryStore)();

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  }));

  // Existing CORS...
  app.use(cors({...}));

  // Existing compression...
  app.use(compression());

  // ───── NEW: Rate limiting (critical for scalability) ─────

  // General rate limiter - 100 requests per 15 minutes per IP
  const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skip: (req) => {
      // Skip rate limiting for admin IP (add to env vars)
      const adminIPs = (process.env.ADMIN_IPS || '').split(',').filter(Boolean);
      return adminIPs.includes(req.ip);
    }
  });

  // Strict rate limiter for auth endpoints - 5 requests per 15 minutes
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true, // Don't count successful auth
    keyGenerator: (req) => {
      // Rate limit by username + IP (prevents brute force)
      return `${req.body.email || req.body.username || 'unknown'}:${req.ip}`;
    }
  });

  // API rate limiter - 1000 requests per hour per API key
  const apiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000,
    keyGenerator: (req) => {
      return req.user?.id || req.ip;
    }
  });

  // Apply general limiter to all requests
  app.use(generalLimiter);

  // ───── NEW: CSRF Protection ─────
  app.use(initializeCsrfProtection); // Initialize on every request
  app.use(verifyCsrfToken); // Verify on state-changing requests

  // Existing body parser...
  app.use(express.json({ limit: '2mb' }));

  // ... rest of middleware ...

  // ═════════════════════════════════════════════════════════════
  // 4. APPLY RATE LIMITERS TO SPECIFIC ROUTES
  // ═════════════════════════════════════════════════════════════

  // Apply auth limiter to login endpoint
  app.post('/api/auth/login', authLimiter, authRoutes);

  // Apply API limiter to API routes
  app.use('/api/', apiLimiter);

  // ═════════════════════════════════════════════════════════════
  // 5. UPDATE AUTH ROUTE - REGENERATE CSRF AFTER LOGIN
  // ═════════════════════════════════════════════════════════════

  // In routes/apiAuth.js, after successful login:
  /*
  router.post('/login', async (req, res) => {
    try {
      // ... existing login logic ...

      if (passwordMatch) {
        // ... set user data ...

        // NEW: Regenerate CSRF token after login for security
        regenerateCsrfToken(req, res, () => {
          res.json({
            success: true,
            data: {
              token: jwtToken,
              csrfToken: req.session.csrfToken // Send new token to client
            }
          });
        });
      }
    } catch (error) {
      // ... error handling ...
    }
  });
  */

  // ═════════════════════════════════════════════════════════════
  // 6. ERROR HANDLERS - AT THE END OF app.js
  // ═════════════════════════════════════════════════════════════

  // 404 handler (before Sentry error handler)
  app.use(notFoundHandler);

  // Global error handler (before Sentry)
  app.use(globalErrorHandler);

  // NEW: Sentry error handler (must be after other error handlers)
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    app.use(Sentry.Handlers.errorHandler({
      shouldHandleError(error) {
        // Only send 500 errors to Sentry
        return error.status === undefined || error.status >= 500;
      }
    }));
  }

  return app;
}

// ═════════════════════════════════════════════════════════════
// 7. ENVIRONMENT VARIABLES TO ADD IN .env
// ═════════════════════════════════════════════════════════════

/*
# Session Management
SESSION_SECRET=your-session-secret-key

# Rate Limiting
ADMIN_IPS=127.0.0.1,YOUR_ADMIN_IP

# Error Tracking
SENTRY_DSN=https://YOUR_KEY@sentry.io/YOUR_PROJECT_ID

# Redis (optional, for session storage)
REDIS_URL=redis://localhost:6379

# CSRF Protection
CSRF_TOKEN_LENGTH=32
*/

// ═════════════════════════════════════════════════════════════
// 8. UPDATE .gitignore
// ═════════════════════════════════════════════════════════════

/*
Add these lines to .gitignore:
.env
.env.local
.env.*.local
node_modules/
Data/
backups/
homework/
homework-submissions/
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.DS_Store
coverage/
dist/
build/
.vscode
.idea
*.swp
*.swo
*/

// ═════════════════════════════════════════════════════════════
// 9. PACKAGE.JSON UPDATES
// ═════════════════════════════════════════════════════════════

/*
Add these dependencies:
npm install express-rate-limit express-session connect-redis @sentry/node @sentry/tracing @sentry/profiling-node

Add these dev dependencies:
npm install --save-dev jest supertest @types/jest

Update scripts in package.json:
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix"
  }
}
*/

module.exports = {
  createApp
};
