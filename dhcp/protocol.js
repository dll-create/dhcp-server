/**
 * DHCP Protocol Parser/Encoder (RFC 2131 / RFC 2132)
 *
 * Handles encoding and decoding of DHCP packets at the binary level.
 */

// DHCP Message Types (Option 53)
const MESSAGE_TYPES = {
  DISCOVER: 1,
  OFFER:    2,
  REQUEST:  3,
  DECLINE:  4,
  ACK:      5,
  NAK:      6,
  RELEASE:  7,
  INFORM:   8,
};

const MESSAGE_TYPE_NAMES = Object.fromEntries(
  Object.entries(MESSAGE_TYPES).map(([k, v]) => [v, k])
);

// Common DHCP Option codes
const OPTIONS = {
  SUBNET_MASK:     1,
  ROUTER:          3,
  DNS:             6,
  HOSTNAME:       12,
  DOMAIN_NAME:    15,
  BROADCAST:      28,
  REQUESTED_IP:   50,
  LEASE_TIME:     51,
  MESSAGE_TYPE:   53,
  SERVER_ID:      54,
  PARAM_LIST:     55,
  MAX_MSG_SIZE:   57,
  RENEWAL_TIME:   58,
  REBIND_TIME:    59,
  CLIENT_ID:      61,
  END:           255,
};

const MAGIC_COOKIE = Buffer.from([99, 130, 83, 99]); // 0x63825363

/**
 * Parse a raw DHCP packet buffer into a structured object.
 */
function decode(buf) {
  if (buf.length < 240) {
    throw new Error(`Packet too short: ${buf.length} bytes`);
  }

  const packet = {
    op:     buf.readUInt8(0),       // 1=BOOTREQUEST, 2=BOOTREPLY
    htype:  buf.readUInt8(1),       // Hardware type (1=Ethernet)
    hlen:   buf.readUInt8(2),       // Hardware address length
    hops:   buf.readUInt8(3),
    xid:    buf.readUInt32BE(4),    // Transaction ID
    secs:   buf.readUInt16BE(8),
    flags:  buf.readUInt16BE(10),
    ciaddr: readIP(buf, 12),        // Client IP
    yiaddr: readIP(buf, 16),        // 'Your' IP (offered)
    siaddr: readIP(buf, 20),        // Server IP
    giaddr: readIP(buf, 24),        // Gateway IP
    chaddr: readMAC(buf, 28, buf.readUInt8(2)), // Client hardware address
    sname:  buf.slice(44, 108).toString('ascii').replace(/\0+$/, ''),
    file:   buf.slice(108, 236).toString('ascii').replace(/\0+$/, ''),
    options: {},
  };

  // Verify magic cookie
  if (!buf.slice(236, 240).equals(MAGIC_COOKIE)) {
    throw new Error('Invalid DHCP magic cookie');
  }

  // Parse options starting at byte 240
  let offset = 240;
  while (offset < buf.length) {
    const code = buf.readUInt8(offset);
    offset++;

    if (code === OPTIONS.END) break;
    if (code === 0) continue; // Padding

    const len = buf.readUInt8(offset);
    offset++;

    const data = buf.slice(offset, offset + len);
    offset += len;

    packet.options[code] = parseOption(code, data);
  }

  // Convenience: extract message type
  if (packet.options[OPTIONS.MESSAGE_TYPE]) {
    packet.type = packet.options[OPTIONS.MESSAGE_TYPE];
    packet.typeName = MESSAGE_TYPE_NAMES[packet.type] || 'UNKNOWN';
  }

  return packet;
}

/**
 * Encode a DHCP packet object into a Buffer.
 */
function encode(packet) {
  const buf = Buffer.alloc(576); // Minimum DHCP packet size
  buf.fill(0);

  buf.writeUInt8(packet.op || 2, 0);       // BOOTREPLY
  buf.writeUInt8(packet.htype || 1, 1);     // Ethernet
  buf.writeUInt8(packet.hlen || 6, 2);
  buf.writeUInt8(packet.hops || 0, 3);
  buf.writeUInt32BE(packet.xid || 0, 4);
  buf.writeUInt16BE(packet.secs || 0, 8);
  buf.writeUInt16BE(packet.flags || 0, 10);

  writeIP(buf, 12, packet.ciaddr || '0.0.0.0');
  writeIP(buf, 16, packet.yiaddr || '0.0.0.0');
  writeIP(buf, 20, packet.siaddr || '0.0.0.0');
  writeIP(buf, 24, packet.giaddr || '0.0.0.0');

  // Write client hardware address
  if (packet.chaddr) {
    const macBytes = packet.chaddr.split(':').map(h => parseInt(h, 16));
    for (let i = 0; i < 16; i++) {
      buf.writeUInt8(macBytes[i] || 0, 28 + i);
    }
  }

  // Magic cookie
  MAGIC_COOKIE.copy(buf, 236);

  // Encode options
  let offset = 240;

  if (packet.options) {
    for (const [code, value] of Object.entries(packet.options)) {
      const codeNum = parseInt(code);
      if (codeNum === OPTIONS.END) continue;

      const encoded = encodeOption(codeNum, value);
      if (encoded) {
        buf.writeUInt8(codeNum, offset);
        offset++;
        buf.writeUInt8(encoded.length, offset);
        offset++;
        encoded.copy(buf, offset);
        offset += encoded.length;
      }
    }
  }

  // End option
  buf.writeUInt8(OPTIONS.END, offset);

  return buf.slice(0, offset + 1);
}

// ── Helpers ──────────────────────────────────────────────────

function readIP(buf, offset) {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

function writeIP(buf, offset, ip) {
  const parts = ip.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    buf.writeUInt8(parts[i] || 0, offset + i);
  }
}

function readMAC(buf, offset, len) {
  const parts = [];
  for (let i = 0; i < (len || 6); i++) {
    parts.push(buf[offset + i].toString(16).padStart(2, '0'));
  }
  return parts.join(':');
}

function parseOption(code, data) {
  switch (code) {
    case OPTIONS.MESSAGE_TYPE:
      return data.readUInt8(0);
    case OPTIONS.SUBNET_MASK:
    case OPTIONS.ROUTER:
    case OPTIONS.SERVER_ID:
    case OPTIONS.REQUESTED_IP:
    case OPTIONS.BROADCAST:
      return readIP(data, 0);
    case OPTIONS.DNS:
      // Can be multiple IPs
      const ips = [];
      for (let i = 0; i < data.length; i += 4) {
        ips.push(readIP(data, i));
      }
      return ips.length === 1 ? ips[0] : ips;
    case OPTIONS.LEASE_TIME:
    case OPTIONS.RENEWAL_TIME:
    case OPTIONS.REBIND_TIME:
      return data.readUInt32BE(0);
    case OPTIONS.HOSTNAME:
    case OPTIONS.DOMAIN_NAME:
      return data.toString('ascii');
    case OPTIONS.PARAM_LIST:
      return Array.from(data);
    case OPTIONS.CLIENT_ID:
      if (data.length > 1 && data[0] === 1) {
        return readMAC(data, 1, 6);
      }
      return data;
    default:
      return data;
  }
}

function encodeOption(code, value) {
  switch (code) {
    case OPTIONS.MESSAGE_TYPE:
      return Buffer.from([value]);
    case OPTIONS.SUBNET_MASK:
    case OPTIONS.ROUTER:
    case OPTIONS.SERVER_ID:
    case OPTIONS.BROADCAST:
    case OPTIONS.REQUESTED_IP: {
      const b = Buffer.alloc(4);
      writeIP(b, 0, value);
      return b;
    }
    case OPTIONS.DNS: {
      const ips = Array.isArray(value) ? value : [value];
      const b = Buffer.alloc(ips.length * 4);
      ips.forEach((ip, i) => writeIP(b, i * 4, ip));
      return b;
    }
    case OPTIONS.LEASE_TIME:
    case OPTIONS.RENEWAL_TIME:
    case OPTIONS.REBIND_TIME: {
      const b = Buffer.alloc(4);
      b.writeUInt32BE(value, 0);
      return b;
    }
    case OPTIONS.HOSTNAME:
    case OPTIONS.DOMAIN_NAME:
      return Buffer.from(value, 'ascii');
    default:
      if (Buffer.isBuffer(value)) return value;
      if (Array.isArray(value)) return Buffer.from(value);
      return null;
  }
}

module.exports = {
  decode,
  encode,
  MESSAGE_TYPES,
  MESSAGE_TYPE_NAMES,
  OPTIONS,
};
