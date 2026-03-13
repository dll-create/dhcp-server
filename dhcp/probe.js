/**
 * Network Safety Probe
 *
 * Sends a DHCP DISCOVER on the selected interface to detect
 * whether an existing DHCP server is already active on that network.
 * This prevents accidental conflicts with production networks.
 */

const dgram = require('dgram');
const crypto = require('crypto');
const protocol = require('./protocol');

const { MESSAGE_TYPES, OPTIONS } = protocol;

const PROBE_TIMEOUT_MS = 4000; // Wait 4 seconds for a response

/**
 * Probe a network interface for existing DHCP servers.
 * Returns { safe: boolean, servers: [...] }
 *
 * This does NOT start a DHCP server — it only sends a single
 * DISCOVER and listens briefly for OFFER responses.
 */
function probeForDHCP(interfaceName) {
  return new Promise((resolve) => {
    const servers = [];
    let socket;

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch (err) {
      // Cannot create socket (no sudo) — treat as safe since
      // the actual DHCP start will also fail with a clear error
      resolve({ safe: true, servers: [], error: 'Cannot create probe socket' });
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve({
        safe: servers.length === 0,
        servers,
      });
    }, PROBE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      try { socket.close(); } catch (e) { /* ignore */ }
    }

    socket.on('error', (err) => {
      cleanup();
      // If we can't bind, we can't probe; let the actual start() handle it
      resolve({ safe: true, servers: [], error: err.message });
    });

    socket.on('message', (msg) => {
      try {
        const pkt = protocol.decode(msg);
        // Look for DHCP OFFER (op=2, type=OFFER)
        if (pkt.op === 2 && pkt.type === MESSAGE_TYPES.OFFER) {
          const serverIP = pkt.options[OPTIONS.SERVER_ID] || pkt.siaddr;
          if (serverIP && serverIP !== '0.0.0.0') {
            servers.push({
              serverIP,
              offeredIP: pkt.yiaddr,
            });
          }
        }
      } catch (e) {
        // Not a valid DHCP packet, ignore
      }
    });

    socket.bind(68, '0.0.0.0', () => {
      socket.setBroadcast(true);

      // Build a DHCP DISCOVER packet with a random xid and MAC
      const xid = crypto.randomBytes(4).readUInt32BE(0);
      const fakeMAC = 'de:ad:be:ef:ca:fe';

      const discover = {
        op: 1,           // BOOTREQUEST
        htype: 1,
        hlen: 6,
        hops: 0,
        xid,
        secs: 0,
        flags: 0x8000,   // Broadcast flag
        ciaddr: '0.0.0.0',
        yiaddr: '0.0.0.0',
        siaddr: '0.0.0.0',
        giaddr: '0.0.0.0',
        chaddr: fakeMAC,
        options: {
          [OPTIONS.MESSAGE_TYPE]: MESSAGE_TYPES.DISCOVER,
        },
      };

      const buf = protocol.encode(discover);
      socket.send(buf, 0, buf.length, 67, '255.255.255.255', (err) => {
        if (err) {
          cleanup();
          resolve({ safe: true, servers: [], error: err.message });
        }
        // Otherwise wait for responses until timeout
      });
    });
  });
}

module.exports = { probeForDHCP };
