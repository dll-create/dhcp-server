/**
 * DHCP Server Core
 *
 * Manages the UDP socket and handles the DHCP handshake flow:
 * DISCOVER → OFFER → REQUEST → ACK
 */

const dgram = require('dgram');
const os = require('os');
const protocol = require('./protocol');
const { LeaseManager, ipToLong, longToIP } = require('./leases');

const { MESSAGE_TYPES, OPTIONS } = protocol;

class DHCPServer {
  constructor() {
    this.socket = null;
    this.running = false;
    this.leaseManager = new LeaseManager();
    this.config = {
      interface: '',
      serverIP: '',
      subnetMask: '255.255.255.0',
      router: '',
      dns: '8.8.8.8',
      rangeStart: '192.168.1.100',
      rangeEnd: '192.168.1.200',
      leaseTime: 3600,
      networkIP: '',
      broadcastIP: '255.255.255.255',
    };
    this.logs = [];
    this.maxLogs = 500;
    this.sseClients = [];
  }

  /**
   * Start the DHCP server on port 67.
   */
  start(config) {
    if (this.running) {
      throw new Error('DHCP server is already running');
    }

    // Update config
    Object.assign(this.config, config);

    // Auto-detect server IP from the selected interface
    if (this.config.interface) {
      const ifaceInfo = this.getInterfaceIP(this.config.interface);
      if (ifaceInfo) {
        this.config.serverIP = ifaceInfo.address;
        if (!config.subnetMask) {
          this.config.subnetMask = ifaceInfo.netmask;
        }
      }
    }

    if (!this.config.serverIP) {
      throw new Error('Cannot determine server IP. Please select a valid network interface.');
    }

    validateIPv4(this.config.serverIP, 'Server IP');
    validateIPv4(this.config.rangeStart, 'IP range start');
    validateIPv4(this.config.rangeEnd, 'IP range end');
    validateSubnetMask(this.config.subnetMask);

    this.config.networkIP = calculateNetworkIP(this.config.serverIP, this.config.subnetMask);
    this.config.broadcastIP = calculateBroadcastIP(this.config.serverIP, this.config.subnetMask);

    // Default router to server IP if not set
    if (!this.config.router) {
      this.config.router = this.config.serverIP;
    }

    validateIPv4(this.config.router, 'Router');
    validatePoolConfiguration(this.config);

    // Configure lease manager
    this.leaseManager.configure({
      rangeStart: this.config.rangeStart,
      rangeEnd: this.config.rangeEnd,
      subnetMask: this.config.subnetMask,
      leaseTime: this.config.leaseTime,
      excludedIPs: [
        this.config.serverIP,
        this.config.router,
        this.config.networkIP,
        this.config.broadcastIP,
      ],
    });

    return new Promise((resolve, reject) => {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        this.log('error', `Socket error: ${err.message}`);
        if (!this.running) {
          reject(err);
        }
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.on('listening', () => {
        this.socket.setBroadcast(true);
        this.running = true;
        const addr = this.socket.address();
        this.log('info', `DHCP Server listening on ${addr.address}:${addr.port}`);
        this.log('info', `Server IP: ${this.config.serverIP}`);
        this.log('info', `IP Range: ${this.config.rangeStart} - ${this.config.rangeEnd}`);
        this.log('info', `Subnet: ${this.config.subnetMask} | Router: ${this.config.router}`);
        this.log('info', `Interface: ${this.config.interface || 'auto'} | Broadcast: ${this.config.broadcastIP}`);
        resolve();
      });

      try {
        this.socket.bind(67, '0.0.0.0');
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Stop the DHCP server.
   */
  stop() {
    return new Promise((resolve) => {
      if (!this.running || !this.socket) {
        this.running = false;
        resolve();
        return;
      }

      this.running = false;
      this.leaseManager.stopCleanup();

      this.socket.close(() => {
        this.log('info', 'DHCP Server stopped');
        this.socket = null;
        resolve();
      });
    });
  }

  /**
   * Handle an incoming DHCP message.
   */
  handleMessage(msg, rinfo) {
    let packet;
    try {
      packet = protocol.decode(msg);
    } catch (err) {
      this.log('warn', `Failed to decode packet from ${rinfo.address}: ${err.message}`);
      return;
    }

    // Only handle BOOTREQUEST (op=1)
    if (packet.op !== 1) return;

    const clientMAC = packet.chaddr;

    switch (packet.type) {
      case MESSAGE_TYPES.DISCOVER:
        this.handleDiscover(packet, clientMAC);
        break;
      case MESSAGE_TYPES.REQUEST:
        this.handleRequest(packet, clientMAC);
        break;
      case MESSAGE_TYPES.RELEASE:
        this.handleRelease(packet, clientMAC);
        break;
      case MESSAGE_TYPES.DECLINE:
        this.handleDecline(packet, clientMAC);
        break;
      case MESSAGE_TYPES.INFORM:
        this.handleInform(packet, clientMAC);
        break;
      default:
        this.log('debug', `Ignoring message type ${packet.typeName} from ${clientMAC}`);
    }
  }

  /**
   * Handle DHCPDISCOVER - offer an IP.
   */
  handleDiscover(packet, clientMAC) {
    this.log('info', `DISCOVER from ${clientMAC}`);

    const offeredIP = this.leaseManager.getOffer(clientMAC);
    if (!offeredIP) {
      this.log('warn', `No available IPs for ${clientMAC} - pool exhausted`);
      return;
    }

    this.log('info', `OFFER ${offeredIP} to ${clientMAC}`);

    const response = this.buildResponse(packet, MESSAGE_TYPES.OFFER, offeredIP);
    this.sendResponse(response, packet);
  }

  /**
   * Handle DHCPREQUEST - confirm the allocation.
   */
  handleRequest(packet, clientMAC) {
    const requestedIP =
      packet.options[OPTIONS.REQUESTED_IP] ||
      packet.ciaddr;

    this.log('info', `REQUEST from ${clientMAC} for ${requestedIP}`);

    // Verify server ID if present
    const serverID = packet.options[OPTIONS.SERVER_ID];
    if (serverID && serverID !== this.config.serverIP) {
      // Request is for a different server, ignore
      this.log('debug', `Ignoring REQUEST for different server: ${serverID}`);
      return;
    }

    // Verify the requested IP is available for this client
    const offer = this.leaseManager.getReservedIP(clientMAC);
    if (!offer || (requestedIP && requestedIP !== '0.0.0.0' && offer !== requestedIP)) {
      // NAK
      this.log('warn', `NAK to ${clientMAC}: requested ${requestedIP} not available`);
      const response = this.buildResponse(packet, MESSAGE_TYPES.NAK, '0.0.0.0');
      this.sendResponse(response, packet);
      return;
    }

    // Assign the lease
    const lease = this.leaseManager.assign(clientMAC, offer);
    this.log('info', `ACK ${offer} to ${clientMAC} (lease: ${lease.leaseTime}s)`);

    const response = this.buildResponse(packet, MESSAGE_TYPES.ACK, offer);
    this.sendResponse(response, packet);
  }

  /**
   * Handle DHCPRELEASE - free the lease.
   */
  handleRelease(packet, clientMAC) {
    this.log('info', `RELEASE from ${clientMAC}`);
    this.leaseManager.release(clientMAC);
  }

  /**
   * Handle DHCPDECLINE - mark IP as unavailable.
   */
  handleDecline(packet, clientMAC) {
    this.log('warn', `DECLINE from ${clientMAC}`);
    // Could mark the IP as unavailable, but for simplicity we just log it
  }

  /**
   * Handle DHCPINFORM - provide config without lease.
   */
  handleInform(packet, clientMAC) {
    this.log('info', `INFORM from ${clientMAC}`);
    const response = this.buildResponse(packet, MESSAGE_TYPES.ACK, packet.ciaddr);
    // Remove lease time for INFORM responses
    delete response.options[OPTIONS.LEASE_TIME];
    delete response.options[OPTIONS.RENEWAL_TIME];
    delete response.options[OPTIONS.REBIND_TIME];
    this.sendResponse(response, packet);
  }

  /**
   * Build a DHCP response packet.
   */
  buildResponse(request, type, assignedIP) {
    const leaseTime = this.config.leaseTime;

    return {
      op: 2,           // BOOTREPLY
      htype: 1,
      hlen: 6,
      hops: 0,
      xid: request.xid,
      secs: 0,
      flags: request.flags,
      ciaddr: '0.0.0.0',
      yiaddr: assignedIP,
      siaddr: this.config.serverIP,
      giaddr: request.giaddr,
      chaddr: request.chaddr,
      options: {
        [OPTIONS.MESSAGE_TYPE]: type,
        [OPTIONS.SERVER_ID]: this.config.serverIP,
        [OPTIONS.SUBNET_MASK]: this.config.subnetMask,
        [OPTIONS.ROUTER]: this.config.router,
        [OPTIONS.DNS]: this.config.dns,
        [OPTIONS.BROADCAST]: this.config.broadcastIP,
        [OPTIONS.LEASE_TIME]: leaseTime,
        [OPTIONS.RENEWAL_TIME]: Math.floor(leaseTime / 2),
        [OPTIONS.REBIND_TIME]: Math.floor(leaseTime * 0.875),
      },
    };
  }

  /**
   * Send a DHCP response.
   */
  sendResponse(responsePacket, requestPacket) {
    const buf = protocol.encode(responsePacket);

    // Determine destination: broadcast if flags indicate, or unicast
    let destIP = this.config.broadcastIP || '255.255.255.255';
    let destPort = 68;

    if (requestPacket.giaddr && requestPacket.giaddr !== '0.0.0.0') {
      destIP = requestPacket.giaddr;
      destPort = 67;
    } else if (requestPacket.flags & 0x8000) {
      destIP = this.config.broadcastIP || '255.255.255.255';
    } else if (responsePacket.yiaddr && responsePacket.yiaddr !== '0.0.0.0') {
      // Could unicast, but broadcast is safer for PXE/BMC clients
      destIP = this.config.broadcastIP || '255.255.255.255';
    }

    this.socket.send(buf, 0, buf.length, destPort, destIP, (err) => {
      if (err) {
        this.log('error', `Failed to send response: ${err.message}`);
      }
    });
  }

  /**
   * Get the IP address of a network interface.
   */
  getInterfaceIP(ifaceName) {
    const ifaces = os.networkInterfaces();
    const iface = ifaces[ifaceName];
    if (!iface) return null;

    const ipv4 = iface.find(i => i.family === 'IPv4' && !i.internal);
    return ipv4 || null;
  }

  /**
   * Get all available network interfaces.
   */
  static getInterfaces() {
    const ifaces = os.networkInterfaces();
    const result = [];

    for (const [name, addrs] of Object.entries(ifaces)) {
      const ipv4 = addrs.find(a => a.family === 'IPv4');
      if (ipv4) {
        result.push({
          name,
          address: ipv4.address,
          netmask: ipv4.netmask,
          mac: ipv4.mac,
          internal: ipv4.internal,
        });
      }
    }

    return result;
  }

  /**
   * Add a log entry.
   */
  log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Send to SSE clients
    this.broadcastSSE(entry);

    // Console output
    const prefix = {
      error: '❌',
      warn: '⚠️ ',
      info: 'ℹ️ ',
      debug: '🔍',
    }[level] || '  ';
    console.log(`${prefix} [DHCP] ${message}`);
  }

  /**
   * Register an SSE client for real-time log streaming.
   */
  addSSEClient(res) {
    this.sseClients.push(res);
    res.on('close', () => {
      this.sseClients = this.sseClients.filter(c => c !== res);
    });
  }

  /**
   * Broadcast a log entry to all SSE clients.
   */
  broadcastSSE(entry) {
    const data = `data: ${JSON.stringify(entry)}\n\n`;
    this.sseClients.forEach(client => {
      try {
        client.write(data);
      } catch (e) {
        // Client disconnected
      }
    });
  }

  /**
   * Get current server status.
   */
  getStatus() {
    return {
      running: this.running,
      config: this.config,
      pool: this.leaseManager.getStats(),
    };
  }
}

function calculateNetworkIP(ip, netmask) {
  const networkLong = (ipToLong(ip) & ipToLong(netmask)) >>> 0;
  return longToIP(networkLong);
}

function calculateBroadcastIP(ip, netmask) {
  const maskLong = ipToLong(netmask);
  const networkLong = (ipToLong(ip) & maskLong) >>> 0;
  const broadcastLong = (networkLong | (~maskLong >>> 0)) >>> 0;
  return longToIP(broadcastLong);
}

function validateIPv4(ip, label) {
  const parts = String(ip).trim().split('.');
  if (parts.length !== 4) {
    throw new Error(`${label} must be a valid IPv4 address.`);
  }

  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      throw new Error(`${label} must be a valid IPv4 address.`);
    }

    const value = Number(part);
    if (value < 0 || value > 255) {
      throw new Error(`${label} must be a valid IPv4 address.`);
    }
  }
}

function validateSubnetMask(mask) {
  validateIPv4(mask, 'Subnet mask');
  const maskLong = ipToLong(mask);
  const inverted = (~maskLong) >>> 0;
  if ((inverted & (inverted + 1)) !== 0) {
    throw new Error('Subnet mask must be contiguous.');
  }
}

function isInSameSubnet(ip, referenceIP, netmask) {
  return calculateNetworkIP(ip, netmask) === calculateNetworkIP(referenceIP, netmask);
}

function validatePoolConfiguration(config) {
  if (!isInSameSubnet(config.rangeStart, config.serverIP, config.subnetMask) ||
      !isInSameSubnet(config.rangeEnd, config.serverIP, config.subnetMask)) {
    throw new Error(
      `IP range must stay in the same subnet as the selected interface (${config.networkIP}/${config.subnetMask}).`
    );
  }

  if (config.router && !isInSameSubnet(config.router, config.serverIP, config.subnetMask)) {
    throw new Error(
      `Router must stay in the same subnet as the selected interface (${config.networkIP}/${config.subnetMask}).`
    );
  }

  const start = ipToLong(config.rangeStart);
  const end = ipToLong(config.rangeEnd);
  const excluded = new Set([
    config.serverIP,
    config.router,
    config.networkIP,
    config.broadcastIP,
  ]);

  let usable = 0;
  for (let current = start; current <= end; current++) {
    if (!excluded.has(longToIP(current))) {
      usable++;
      break;
    }
  }

  if (usable === 0) {
    throw new Error('IP range contains only reserved addresses. Choose a larger usable range.');
  }
}

module.exports = DHCPServer;
