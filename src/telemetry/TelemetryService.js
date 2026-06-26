const fs = require('fs');
const path = require('path');
const { getWorkspaceRoot } = require('../tools/fileSystem');
const { Logger } = require('./Logger');

class TelemetryService {
  static metrics = {};
  static file = null;

  static init() {
    try {
      const root = getWorkspaceRoot();
      if (root) {
        const dir = path.join(root, '.jarvix', 'telemetry');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, 'metrics.json');
        
        if (fs.existsSync(this.file)) {
          this.metrics = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        }
      }
    } catch (e) {
      Logger.error('TelemetryService', 'Failed to init telemetry', e);
    }
  }

  static trackEvent(eventName, data = {}) {
    if (!this.metrics[eventName]) {
      this.metrics[eventName] = { count: 0, data: [] };
    }
    
    this.metrics[eventName].count++;
    this.metrics[eventName].data.push({ timestamp: new Date().toISOString(), ...data });
    
    // Keep bounded history
    if (this.metrics[eventName].data.length > 1000) {
      this.metrics[eventName].data.shift();
    }

    Logger.debug('Telemetry', `Tracked event: ${eventName}`, data);
    this._flush();
  }

  static recordMetric(metricName, value) {
    if (!this.metrics[metricName]) {
      this.metrics[metricName] = { values: [] };
    }
    this.metrics[metricName].values.push({ timestamp: new Date().toISOString(), value });
    
    if (this.metrics[metricName].values.length > 1000) {
      this.metrics[metricName].values.shift();
    }
    this._flush();
  }

  static getSummary() {
    const summary = {};
    for (const [key, val] of Object.entries(this.metrics)) {
      if (val.count !== undefined) summary[key] = val.count;
      else if (val.values) {
        const sum = val.values.reduce((acc, curr) => acc + curr.value, 0);
        summary[key] = { avg: sum / val.values.length, count: val.values.length };
      }
    }
    return summary;
  }

  static _flush() {
    if (!this.file) return;
    // Debounce write could be added here, using simple sync write for now
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.metrics, null, 2));
    } catch (e) {
      Logger.error('TelemetryService', 'Failed to write metrics', e);
    }
  }
}

module.exports = { TelemetryService };
