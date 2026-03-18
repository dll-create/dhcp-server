class DhcpServer < Formula
  desc "Lightweight DHCP server with modern web UI for BMC provisioning"
  homepage "https://github.com/dll-create/dhcp-server"
  url "https://github.com/dll-create/dhcp-server/releases/download/v1.0.1/dhcp-server-source-1.0.1.tar.gz"
  sha256 "d781a567df9280bf1f0494062e49af8168e4a2dc799403bdd9cd60ed51896dc4"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", "--production"
    libexec.install Dir["*"]

    (bin/"dhcp-server").write <<~EOS
      #!/bin/bash
      echo ""
      echo "⚡ DHCP Server — http://localhost:3000"
      echo ""
      echo "⚠️  Safety warning:"
      echo "   Only use on direct-connect interfaces (e.g., laptop → BMC)"
      echo "   Do NOT use on networks with existing DHCP servers"
      echo ""

      if [ "$EUID" -ne 0 ] && [ "$(id -u)" -ne 0 ]; then
        echo "🔑 DHCP requires sudo for port 67. Starting web UI only..."
        echo "   Run 'sudo dhcp-server' for full DHCP functionality."
        echo ""
      fi

      exec node "#{libexec}/server.js" "$@"
    EOS
  end

  def caveats
    <<~EOS
      DHCP Server has been installed.

      To start the web UI (no DHCP):
        dhcp-server

      To start with full DHCP functionality:
        sudo dhcp-server

      Then open http://localhost:3000

      ⚠️  WARNING: Only use on direct-connect interfaces.
      Never run on a network with an existing DHCP server.
    EOS
  end

  test do
    fork do
      exec "node", "#{libexec}/server.js"
    end
    sleep 2
    assert_match "interfaces", shell_output("curl -s http://localhost:3000/api/interfaces")
  end
end
