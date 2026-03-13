/**
 * DHCP Lease Manager
 *
 * Manages the IP address pool, active leases, and lease expiration.
 */

class LeaseManager {
  constructor() {
    this.leases = new Map();        // MAC -> lease object
    this.pool = [];                 // Available IP addresses
    this.rangeStart = '';
    this.rangeEnd = '';
    this.subnetMask = '255.255.255.0';
    this.defaultLeaseTime = 3600;   // 1 hour in seconds
    this.cleanupTimer = null;
  }

  /**
   * Configure the IP pool from a range.
   */
  configure({ rangeStart, rangeEnd, subnetMask, leaseTime }) {
    this.rangeStart = rangeStart;
    this.rangeEnd = rangeEnd;
    this.subnetMask = subnetMask || '255.255.255.0';
    this.defaultLeaseTime = leaseTime || 3600;

    // Build the pool
    this.pool = [];
    const start = ipToLong(rangeStart);
    const end = ipToLong(rangeEnd);

    if (start > end) {
      throw new Error(`Invalid IP range: ${rangeStart} - ${rangeEnd}`);
    }

    if (end - start > 1000) {
      throw new Error('IP range too large (max 1000 addresses)');
    }

    for (let i = start; i <= end; i++) {
      this.pool.push(longToIP(i));
    }

    // Start lease cleanup timer
    this.startCleanup();
  }

  /**
   * Get an available IP for a MAC address.
   * If the MAC already has an active lease, return the same IP.
   */
  getOffer(mac) {
    const normalizedMac = mac.toLowerCase();

    // Check existing lease
    const existing = this.leases.get(normalizedMac);
    if (existing && !this.isExpired(existing)) {
      return existing.ip;
    }

    // Find an available IP from the pool
    for (const ip of this.pool) {
      if (!this.isAllocated(ip)) {
        return ip;
      }
    }

    return null; // Pool exhausted
  }

  /**
   * Assign (confirm) a lease for a MAC address.
   */
  assign(mac, ip) {
    const normalizedMac = mac.toLowerCase();
    const now = Date.now();
    const leaseTime = this.defaultLeaseTime;

    const lease = {
      mac: normalizedMac,
      ip,
      assignedAt: now,
      expiresAt: now + leaseTime * 1000,
      leaseTime,
    };

    this.leases.set(normalizedMac, lease);
    return lease;
  }

  /**
   * Release a lease by MAC address.
   */
  release(mac) {
    const normalizedMac = mac.toLowerCase();
    return this.leases.delete(normalizedMac);
  }

  /**
   * Get all active leases as an array.
   */
  getAll() {
    const now = Date.now();
    const result = [];

    for (const [mac, lease] of this.leases) {
      result.push({
        mac: lease.mac,
        ip: lease.ip,
        assignedAt: new Date(lease.assignedAt).toISOString(),
        expiresAt: new Date(lease.expiresAt).toISOString(),
        remaining: Math.max(0, Math.floor((lease.expiresAt - now) / 1000)),
        expired: lease.expiresAt < now,
      });
    }

    return result;
  }

  /**
   * Check if an IP is currently allocated to any active lease.
   */
  isAllocated(ip) {
    for (const lease of this.leases.values()) {
      if (lease.ip === ip && !this.isExpired(lease)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a lease has expired.
   */
  isExpired(lease) {
    return lease.expiresAt < Date.now();
  }

  /**
   * Clean up expired leases.
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [mac, lease] of this.leases) {
      if (lease.expiresAt < now) {
        this.leases.delete(mac);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Start periodic cleanup of expired leases.
   */
  startCleanup() {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => this.cleanup(), 60000); // Every minute
  }

  /**
   * Stop the cleanup timer.
   */
  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Get pool statistics.
   */
  getStats() {
    const total = this.pool.length;
    const active = this.getAll().filter(l => !l.expired).length;
    return {
      total,
      active,
      available: total - active,
      rangeStart: this.rangeStart,
      rangeEnd: this.rangeEnd,
    };
  }

  /**
   * Reset all leases and stop cleanup.
   */
  reset() {
    this.leases.clear();
    this.stopCleanup();
  }
}

// ── IP Utility Functions ──────────────────────────────────────

function ipToLong(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function longToIP(long) {
  return [
    (long >>> 24) & 255,
    (long >>> 16) & 255,
    (long >>> 8) & 255,
    long & 255,
  ].join('.');
}

module.exports = { LeaseManager, ipToLong, longToIP };
