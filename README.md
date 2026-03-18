# ⚡ DHCP Server

A lightweight, cross-platform DHCP server with a modern web UI — built for field engineers who need to quickly assign IP addresses to server BMC/IPMI ports using a laptop.

> **No more Windows VMs.** Just plug in an Ethernet cable, pick your interface, and click Start.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)

## ✨ Features

- 🎨 **Modern Dark UI** — Glassmorphism design, real-time logs, live lease table
- 🛡️ **Network Safety Probe** — Automatically detects existing DHCP servers before starting, preventing conflicts
- 🌐 **Bilingual** — English & 中文 with one-click toggle
- 📡 **Full DHCP Stack** — Custom RFC 2131 implementation (DISCOVER → OFFER → REQUEST → ACK)
- ⚙️ **Zero Config** — Auto-detects interfaces, sensible defaults
- 🖥️ **Desktop App** — Optional Electron wrapper for native macOS experience

## 🚨 Safety First

> **⚠️ This tool is designed for direct-connect scenarios only** (e.g., laptop → BMC ethernet port via cable).
>
> **Never run on a network with an existing DHCP server.** The built-in safety probe will warn you, but exercise caution.

## 🚀 Quick Start

### Homebrew

```bash
# Install
brew tap dll-create/dhcp-server https://github.com/dll-create/dhcp-server
brew install dhcp-server

# Upgrade
brew update
brew upgrade dhcp-server
```

Start the Web UI:

```bash
dhcp-server
```

Start with full DHCP capability:

```bash
sudo dhcp-server
```

Open **http://localhost:3000** in your browser.

### From Source

```bash
# Clone
git clone https://github.com/dll-create/dhcp-server.git
cd dhcp-server

# Install
npm install

# Run (Web UI only, no DHCP yet)
node server.js

# Run with DHCP capability (requires sudo for port 67)
sudo node server.js
```

Open **http://localhost:3000** in your browser.

### Desktop App (Electron)

```bash
npx electron .           # UI only
sudo npx electron .      # Full DHCP functionality
```

## 📖 Usage

1. **Select** the Ethernet interface connected to your BMC/server
2. **Configure** IP range, subnet mask, gateway, DNS
3. **Keep the IP range in the same subnet** as the selected interface
4. **Click Start** — the safety probe runs first to check for conflicts
5. **Connect** your Ethernet cable to the BMC port
6. **Watch** the lease appear in the table as the BMC gets its IP
7. **Use** the assigned IP to access the BMC web console
8. **Verify the log shows** `DISCOVER -> OFFER -> REQUEST -> ACK`
9. **Stop** when done

## 🏗️ Architecture

```
dhcp-server/
├── server.js            # Express HTTP server + REST API
├── main.js              # Electron main process (optional)
├── dhcp/
│   ├── protocol.js      # DHCP packet parser/encoder (RFC 2131)
│   ├── server.js        # DHCP service core (UDP port 67)
│   ├── leases.js        # IP pool & lease management
│   └── probe.js         # Network safety detection
├── public/
│   ├── index.html       # Single-page UI
│   ├── index.css        # Dark theme + glassmorphism
│   └── app.js           # Frontend logic + i18n
└── start.sh             # macOS launcher with sudo
```

## 📡 API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/interfaces` | List network interfaces |
| `GET` | `/api/status` | Server status & config |
| `POST` | `/api/probe` | Probe for existing DHCP servers |
| `POST` | `/api/start` | Start DHCP service |
| `POST` | `/api/stop` | Stop DHCP service |
| `GET` | `/api/leases` | Current lease table |
| `GET` | `/api/logs` | Real-time log stream (SSE) |

## 🤝 Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

## 📄 License

[MIT](LICENSE)
