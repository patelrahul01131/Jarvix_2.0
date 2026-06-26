/**
 * Basic in-memory rate limiter to prevent LLM abuse.
 * Tracks requests per IP.
 */
const rateLimitCache = new Map();

function rateLimiter(options = { windowMs: 60000, max: 20 }) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitCache.has(ip)) {
      rateLimitCache.set(ip, { count: 1, resetTime: now + options.windowMs });
      return next();
    }
    
    const record = rateLimitCache.get(ip);
    
    if (now > record.resetTime) {
      record.count = 1;
      record.resetTime = now + options.windowMs;
      return next();
    }
    
    record.count++;
    
    if (record.count > options.max) {
      return res.status(429).json({ error: "Too many requests, please try again later." });
    }
    
    next();
  };
}

module.exports = { rateLimiter };
