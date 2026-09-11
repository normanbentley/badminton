'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
let warned = false;

module.exports = function cleanupBrowser(work) {
  if (!fs.existsSync(work)) return;
  const absolute = fs.realpathSync(work), temp = fs.realpathSync(os.tmpdir());
  if (path.dirname(absolute) !== temp || !/^(drill-deck-|racket-ready-|shuttle-split-|junior-doubles-browser-)/.test(path.basename(absolute))) {
    throw Error('Refusing to remove a directory outside the browser test temporary roots.');
  }
  try { fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) {
    // Windows can retain locks after Browser.close. A leftover disposable
    // profile is not a failed application assertion. Keep it for OS cleanup;
    // do not obscure a rendering/assertion exception with a cleanup exception.
    if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
    if (!warned) { process.emitWarning('Windows retained a temporary Chrome profile after shutdown. Browser assertions still run; locked profiles are left in the system temp directory.'); warned = true; }
  }
};
