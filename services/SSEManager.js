/**
 * SSE Manager Service
 * Manages Server-Sent Events connections for real-time job updates
 * @module SSEManager
 */

class SSEManager {
  /**
   * Create a new SSEManager instance
   */
  constructor() {
    /** @type {Map<string, Set>} */
    this.connections = new Map();
  }

  /**
   * Add a new SSE connection for a job
   * @param {string} jobId - Job identifier
   * @param {Object} res - Express response object
   */
  addConnection(jobId, res) {
    if (!this.connections.has(jobId)) {
      this.connections.set(jobId, new Set());
    }
    this.connections.get(jobId).add(res);

    res.on('close', () => {
      this.removeConnection(jobId, res);
    });
  }

  /**
   * Remove an SSE connection for a job
   * @param {string} jobId - Job identifier
   * @param {Object} res - Express response object
   */
  removeConnection(jobId, res) {
    const connections = this.connections.get(jobId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        this.connections.delete(jobId);
      }
    }
  }

  /**
   * Broadcast data to all SSE connections for a job
   * @param {string} jobId - Job identifier
   * @param {Object} data - Data to broadcast
   */
  broadcast(jobId, data) {
    const connections = this.connections.get(jobId);
    if (!connections || connections.size === 0) {
      console.log(`[SSE] No connections for job ${jobId}`);
      return;
    }

    const message = `data: ${JSON.stringify(data)}\n\n`;
    const deadConnections = [];

    for (const res of connections) {
      try {
        if (res.destroyed || res.finished || !res.writable) {
          deadConnections.push(res);
          continue;
        }

        res.write(message);
        console.log(`[SSE] Sent update to job ${jobId}:`, data);
      } catch (err) {
        console.warn(`[SSE] Failed to send update to job ${jobId}:`, err);
        deadConnections.push(res);
      }
    }

    deadConnections.forEach(res => this.removeConnection(jobId, res));
  }

  /**
   * Get the number of active connections for a job
   * @param {string} jobId - Job identifier
   * @returns {number} Number of active connections
   */
  getConnectionCount(jobId) {
    const connections = this.connections.get(jobId);
    return connections ? connections.size : 0;
  }

  /**
   * Get all job IDs with active SSE connections
   * @returns {string[]} Array of job IDs
   */
  getActiveJobIds() {
    return Array.from(this.connections.keys());
  }
}

module.exports = SSEManager;
