/**
 * Unit tests for validators.isSafeUrl (utils/validators.js).
 *
 * Guards ctaLink/imageUrl on marketing banners, which routes/marketing.js
 * (public, unauthenticated) returns verbatim for the frontend to drop into
 * an href/src. See routes/admin/marketing.js.
 */

'use strict';

const validators = require('../../utils/validators');

describe('validators.isSafeUrl', () => {
  test.each([
    undefined,
    null,
    '',
  ])('treats empty/missing value %p as valid (field is optional)', (value) => {
    expect(validators.isSafeUrl(value)).toBe(true);
  });

  test.each([
    'https://chawlaclasses.com/offer',
    'http://example.com/banner.png',
    '/admissions',
    '/images/offer.png',
  ])('accepts safe URL: %s', (value) => {
    expect(validators.isSafeUrl(value)).toBe(true);
  });

  test.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.com/phish',
    'not a url at all',
  ])('rejects unsafe/invalid value: %s', (value) => {
    expect(() => validators.isSafeUrl(value)).toThrow();
  });
});
