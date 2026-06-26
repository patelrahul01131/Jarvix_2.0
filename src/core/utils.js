'use strict';

const path = require('path');

/**
 * Shared Utilities — src/core/utils.js
 *
 * Consolidates repeated patterns found across loop.js (×4), planner.js (×1),
 * reflection.js (×1), and executor.js (×5).
 */

// ─── JSON Extraction ────────────────────────────────────────────────────────

/**
 * Extract the first valid JSON object `{}` or array `[]` from an LLM text response.
 * Returns the parsed value, or null if nothing valid is found.
 *
 * @param {string} text  - Raw LLM output
 * @param {object} [opts]
 * @param {boolean} [opts.preferArray=false] - Prefer extracting `[...]` over `{...}`
 * @returns {object|Array|null}
 */
function extractJson(text, opts = {}) {
  if (!text || typeof text !== 'string') return null;

  const { preferArray = false } = opts;

  // Strip common markdown code fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/im, '')
    .trim();

  const openers   = preferArray ? ['[', '{'] : ['{', '['];
  const closerMap = { '{': '}', '[': ']' };

  for (const open of openers) {
    const start = cleaned.indexOf(open);
    if (start === -1) continue;

    let depth    = 0;
    let end      = -1;
    const close  = closerMap[open];

    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === open)  depth++;
      if (cleaned[i] === close) depth--;
      if (depth === 0) { end = i; break; }
    }

    if (end === -1) continue;

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (_) {
      // Continue to next opener
    }
  }

  return null;
}

// ─── Safe Path Resolution ───────────────────────────────────────────────────

/**
 * Resolve `relativePath` against `workspaceRoot` and guard against path-traversal
 * attacks (e.g. `../../etc/passwd`).
 *
 * Returns the absolute resolved path if safe, throws an Error otherwise.
 *
 * @param {string} workspaceRoot  - Absolute path to the workspace root
 * @param {string} relativePath   - Relative (or absolute) path from the agent plan
 * @returns {string} Resolved absolute path
 * @throws {Error} If the resolved path escapes the workspace root
 */
function safeResolvePath(workspaceRoot, relativePath) {
  if (!workspaceRoot || !relativePath) {
    throw new Error('safeResolvePath: workspaceRoot and relativePath are required');
  }

  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved       = path.resolve(workspaceRoot, relativePath);

  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error(
      `[Security] Path traversal detected: "${relativePath}" resolves outside workspace root.`
    );
  }

  return resolved;
}

// ─── String Utilities ───────────────────────────────────────────────────────

/**
 * Generate a short random ID (non-cryptographic, for display purposes).
 * Uses crypto for better entropy when available.
 *
 * @param {number} [length=8]
 * @returns {string}
 */
function shortId(length = 8) {
  try {
    const { randomBytes } = require('crypto');
    return randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  } catch (_) {
    return Math.random().toString(36).slice(2, 2 + length);
  }
}

/**
 * Truncate a string to maxLength, appending '…' if truncated.
 *
 * @param {string} str
 * @param {number} [maxLength=500]
 * @returns {string}
 */
function truncate(str, maxLength = 500) {
  if (!str || str.length <= maxLength) return str || '';
  return str.slice(0, maxLength) + '…';
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  extractJson,
  safeResolvePath,
  shortId,
  truncate,
};
