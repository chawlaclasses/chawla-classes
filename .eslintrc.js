module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'airbnb-base'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // Errors - Strict
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-var': 'error',
    'prefer-const': 'error',
    'eqeqeq': ['error', 'always'],
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',

    // Warnings - Best Practices
    'max-len': ['warn', { code: 120, ignoreUrls: true, ignoreStrings: true }],
    'no-param-reassign': ['warn', { props: false }],
    'func-names': ['warn', 'as-needed'],
    'object-shorthand': ['warn', 'always'],
    'no-plusplus': ['warn', { allowForLoopAfterthoughts: true }],

    // Naming conventions
    'camelcase': ['warn', { properties: 'never' }],

    // Comments
    'no-inline-comments': 'warn',
    'spaced-comment': ['warn', 'always'],

    // Async/Await
    'require-await': 'warn',
    'no-async-promise-executor': 'error',

    // Disabled (too strict for Express.js)
    'consistent-return': 'off',
    'no-underscore-dangle': 'off',
    'import/no-unresolved': 'off',
    'import/extensions': 'off',
    'func-names': 'off'
  },
  overrides: [
    {
      files: ['**/*.test.js', '**/*.spec.js', '__tests__/**/*.js'],
      env: { jest: true },
      rules: {
        'no-unused-vars': 'off'
      }
    }
  ]
};
