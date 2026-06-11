/**
 * Failure Domain Model
 * Records a specific failure event with environment context and expiration.
 */
class Failure {
  constructor(data = {}) {
    this.id = data.id || `fail_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.strategy = data.strategy || "unknown"; // e.g., 'npm_install'
    this.reason = data.reason || "unknown";
    this.environment = data.environment || {}; // e.g., { os: 'win32', network: 'offline' }
    
    this.observedAt = data.observedAt || new Date().toISOString();
    
    // Optional expiration time for ephemeral failures (like network drops)
    this.expiresAt = data.expiresAt || null; 
  }

  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }
}

module.exports = Failure;
