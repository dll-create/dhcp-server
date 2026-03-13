#!/bin/bash
# ═══════════════════════════════════════════════════════
#  DHCP Server Launcher
#  Requires sudo for port 67/68 (privileged ports)
# ═══════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3000

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║  macOS DHCP Server                                ║"
echo "║  ⚠️  WARNING: DHCP 服务需要 sudo 权限运行          ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""
echo "⚠️  安全提示："
echo "   • 请仅在直连的独立网口上使用（如通过网线直连 BMC）"
echo "   • 切勿在已有 DHCP 服务的网络上启动，否则会造成 IP 冲突"
echo "   • 启动后请在 Web UI 中选择正确的网卡"
echo ""

# Check if node_modules exists
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📦 Installing dependencies..."
  cd "$SCRIPT_DIR"
  npm install
  echo ""
fi

# Check if already running
if lsof -i :$PORT > /dev/null 2>&1; then
  echo "⚠️  Port $PORT is already in use. Please stop the existing process first."
  exit 1
fi

# Run with sudo
if [ "$EUID" -ne 0 ]; then
  echo "🔑 Requesting sudo access for DHCP port 67..."
  exec sudo node "$SCRIPT_DIR/server.js"
else
  exec node "$SCRIPT_DIR/server.js"
fi
