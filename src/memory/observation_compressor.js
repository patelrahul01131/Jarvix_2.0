/**
 * Observation Compressor
 * Responsible for compressing raw execution logs and chat messages into
 * semantic summaries, while preserving critical event signatures.
 */

class ObservationCompressor {
  constructor() {
    this.criticalKeywords = ["error", "fail", "denied", "eacces", "eaddrinuse", "timeout", "not found"];
  }

  /**
   * Compresses a raw string of logs into a structured object.
   */
  compress(rawString) {
    if (!rawString || typeof rawString !== 'string') return null;

    const lines = rawString.split('\\n').filter(l => l.trim().length > 0);
    
    // 1. Deduplicate
    const lineCounts = new Map();
    lines.forEach(line => {
      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    });

    const criticalEvents = [];
    const summaries = [];

    // 2. Extract & Summarize
    for (const [line, count] of lineCounts.entries()) {
      const isCritical = this.criticalKeywords.some(kw => line.toLowerCase().includes(kw));
      
      if (isCritical) {
        criticalEvents.push(count > 1 ? `[${count}x] ${line}` : line);
      } else {
        if (count > 3) {
          // Compress high-frequency non-critical noise
          summaries.push(`[${count}x] ${line.substring(0, 50)}...`);
        } else if (lines.length < 20) {
          // If the log is short, keep it
          summaries.push(line);
        }
      }
    }

    if (lines.length >= 20 && summaries.length === 0) {
      summaries.push(`[${lines.length} lines of routine execution output]`);
    }

    // 3. Construct Compressed State
    return {
      rawLineCount: lines.length,
      compressedSummary: summaries.join('\n'),
      criticalEvents: criticalEvents,
      hasCriticalEvents: criticalEvents.length > 0
    };
  }
}

// Singleton
const compressor = new ObservationCompressor();

module.exports = { ObservationCompressor, compressor };
