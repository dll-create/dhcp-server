/**
 * Express Web Server
 *
 * Provides REST API and serves the Web UI for DHCP server management.
 */

const express = require('express');
const path = require('path');
const DHCPServer = require('./dhcp/server');
const { probeForDHCP } = require('./dhcp/probe');

const app = express();
const dhcpServer = new DHCPServer();

const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──────────────────────────────────────────────

/**
 * GET /api/interfaces
 * List available network interfaces.
 */
app.get('/api/interfaces', (req, res) => {
  try {
    const interfaces = DHCPServer.getInterfaces();
    res.json({ interfaces });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status
 * Get DHCP server status and configuration.
 */
app.get('/api/status', (req, res) => {
  res.json(dhcpServer.getStatus());
});

/**
 * POST /api/probe
 * Probe the specified interface for existing DHCP servers.
 * This is a safety check before starting.
 */
app.post('/api/probe', async (req, res) => {
  try {
    const result = await probeForDHCP(req.body.interface);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/start
 * Start the DHCP server with given configuration.
 */
app.post('/api/start', async (req, res) => {
  try {
    const config = req.body;
    await dhcpServer.start(config);
    res.json({ success: true, status: dhcpServer.getStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/stop
 * Stop the DHCP server.
 */
app.post('/api/stop', async (req, res) => {
  try {
    await dhcpServer.stop();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/leases
 * Get all current DHCP leases.
 */
app.get('/api/leases', (req, res) => {
  res.json({ leases: dhcpServer.leaseManager.getAll() });
});

/**
 * GET /api/logs
 * SSE endpoint for real-time log streaming.
 */
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send existing logs as initial batch
  dhcpServer.logs.forEach(entry => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  });

  // Register for future events
  dhcpServer.addSSEClient(res);
});

/**
 * GET /api/logs/history
 * Get all stored log entries.
 */
app.get('/api/logs/history', (req, res) => {
  res.json({ logs: dhcpServer.logs });
});

// ── Start HTTP Server ──────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════╗`);
  console.log(`║   DHCP Server Web UI                          ║`);
  console.log(`║   http://localhost:${PORT}                       ║`);
  console.log(`╚═══════════════════════════════════════════════╝\n`);
});
