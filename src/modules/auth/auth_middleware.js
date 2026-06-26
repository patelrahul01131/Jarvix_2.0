/**
 * JWT Authentication Middleware
 * Protects endpoints from unauthorized access.
 */
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "jarvix-dev-secret-key-change-in-production";

function authenticateToken(req, res, next) {
  // Extract token from header
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>

  if (!token) {
    // For local dev where extension isn't sending token yet
    if (process.env.NODE_ENV === "development" || !process.env.REQUIRE_AUTH) {
      req.user = { id: "local_dev_user", role: "admin" };
      return next();
    }
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token." });
    }
    req.user = user;
    next();
  });
}

function generateToken(userPayload) {
  return jwt.sign(userPayload, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = { authenticateToken, generateToken };
