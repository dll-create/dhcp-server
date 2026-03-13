/**
 * DHCP Server — Frontend Application Logic
 *
 * Features:
 * - API communication & SSE log streaming
 * - Network safety probe before DHCP start
 * - Bilingual UI (English / 中文)
 */

// ── i18n ───────────────────────────────────────────────────
const LANG = {
  en: {
    selectInterface: '— Select an interface —',
    noInterfaces: 'No interfaces found',
    loopback: 'Loopback',
    startServer: 'Start Server',
    stopServer: 'Stop Server',
    running: 'Running',
    stopped: 'Stopped',
    noLeases: 'No active leases',
    active: 'Active',
    expired: 'Expired',
    waitingLog: 'Waiting for server to start...',
    selectInterfaceWarn: 'Please select a network interface',
    probing: 'Checking network safety...',
    probeFound: '⚠️ DHCP CONFLICT DETECTED!\n\nExisting DHCP server(s) found on this network:\n\n{servers}\n\nStarting your DHCP server on this interface WILL cause IP conflicts and may disrupt the existing network.\n\nAre you absolutely sure you want to continue?',
    probeSafe: 'No existing DHCP servers detected on this interface. Safe to start.',
    probeError: 'Could not probe network (may need sudo). Continue anyway?',
    poolSize: 'Pool Size',
    activeLeases: 'Active Leases',
    available: 'Available',
    serverIP: 'Server IP',
    langSwitch: '中文',
  },
  zh: {
    selectInterface: '— 选择网络接口 —',
    noInterfaces: '未找到网络接口',
    loopback: '回环',
    startServer: '启动服务',
    stopServer: '停止服务',
    running: '运行中',
    stopped: '已停止',
    noLeases: '暂无活跃租约',
    active: '活跃',
    expired: '已过期',
    waitingLog: '等待服务启动...',
    selectInterfaceWarn: '请先选择网络接口',
    probing: '正在检测网络安全性...',
    probeFound: '⚠️ 检测到 DHCP 冲突！\n\n当前网络中已存在以下 DHCP 服务器：\n\n{servers}\n\n在此接口启动 DHCP 服务将导致 IP 冲突，可能影响现有网络。\n\n确定要继续吗？',
    probeSafe: '未检测到现有 DHCP 服务器，可以安全启动。',
    probeError: '无法检测网络（可能需要 sudo 权限）。是否继续？',
    poolSize: '地址池',
    activeLeases: '活跃租约',
    available: '可用',
    serverIP: '服务器 IP',
    langSwitch: 'EN',
  },
};

let currentLang = (navigator.language || '').startsWith('zh') ? 'zh' : 'en';
function t(key) { return LANG[currentLang][key] || LANG.en[key] || key; }

// ── State ──────────────────────────────────────────────────
let isRunning = false;
let sseSource = null;
let refreshTimer = null;

// ── DOM Elements ───────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  interfaceSelect: $('interfaceSelect'),
  rangeStart:    $('rangeStart'),
  rangeEnd:      $('rangeEnd'),
  subnetMask:    $('subnetMask'),
  router:        $('router'),
  dns:           $('dns'),
  leaseTime:     $('leaseTime'),
  toggleBtn:     $('toggleBtn'),
  toggleText:    $('toggleText'),
  toggleIcon:    $('toggleIcon'),
  statusBadge:   $('statusBadge'),
  statusDot:     $('statusDot'),
  statusText:    $('statusText'),
  leasesBody:    $('leasesBody'),
  leaseCount:    $('leaseCount'),
  logContainer:  $('logContainer'),
  statTotal:     $('statTotal'),
  statActive:    $('statActive'),
  statAvailable: $('statAvailable'),
  statServerIP:  $('statServerIP'),
  langBtn:       $('langBtn'),
};

// ── Initialization ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadInterfaces();
  loadStatus();
  startAutoRefresh();
  updateLanguageUI();

  if (els.langBtn) {
    els.langBtn.addEventListener('click', toggleLanguage);
  }
});

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'zh' : 'en';
  updateLanguageUI();
}

function updateLanguageUI() {
  // Update static translatable elements
  if (els.langBtn) els.langBtn.textContent = t('langSwitch');
  if (!isRunning) {
    els.toggleText.textContent = t('startServer');
    els.statusText.textContent = t('stopped');
  } else {
    els.toggleText.textContent = t('stopServer');
    els.statusText.textContent = t('running');
  }

  // Update stat labels
  document.querySelectorAll('.stat-label').forEach((el, i) => {
    const keys = ['poolSize', 'activeLeases', 'available', 'serverIP'];
    if (keys[i]) el.textContent = t(keys[i]);
  });
}

// ── API Calls ──────────────────────────────────────────────

async function loadInterfaces() {
  try {
    const res = await fetch('/api/interfaces');
    const data = await res.json();
    const select = els.interfaceSelect;
    select.innerHTML = '';

    if (data.interfaces.length === 0) {
      select.innerHTML = `<option value="">${t('noInterfaces')}</option>`;
      return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('selectInterface');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    const sorted = [...data.interfaces].sort((a, b) => {
      if (a.internal !== b.internal) return a.internal ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    sorted.forEach(iface => {
      const opt = document.createElement('option');
      opt.value = iface.name;
      const tag = iface.internal ? t('loopback') : iface.mac;
      opt.textContent = `${iface.name}  —  ${iface.address}  (${tag})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load interfaces:', err);
  }
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateUI(data);
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

async function loadLeases() {
  try {
    const res = await fetch('/api/leases');
    const data = await res.json();
    renderLeases(data.leases);
  } catch (err) {
    console.error('Failed to load leases:', err);
  }
}

// ── Network Safety Probe ───────────────────────────────────

async function probeNetwork(interfaceName) {
  try {
    const res = await fetch('/api/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interface: interfaceName }),
    });
    return await res.json();
  } catch (err) {
    return { safe: true, servers: [], error: err.message };
  }
}

// ── Server Control ─────────────────────────────────────────

async function toggleServer() {
  const btn = els.toggleBtn;
  btn.disabled = true;

  try {
    if (isRunning) {
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setRunningState(false);
        disconnectSSE();
      }
    } else {
      const config = {
        interface:  els.interfaceSelect.value,
        rangeStart: els.rangeStart.value,
        rangeEnd:   els.rangeEnd.value,
        subnetMask: els.subnetMask.value,
        router:     els.router.value || undefined,
        dns:        els.dns.value,
        leaseTime:  parseInt(els.leaseTime.value) || 3600,
      };

      if (!config.interface) {
        showToast(t('selectInterfaceWarn'));
        btn.disabled = false;
        return;
      }

      // ── Safety probe ────────────────────────────────
      els.toggleText.textContent = t('probing');
      const probe = await probeNetwork(config.interface);

      if (!probe.safe && probe.servers.length > 0) {
        const serverList = probe.servers
          .map(s => `  • Server: ${s.serverIP}  (offered ${s.offeredIP})`)
          .join('\n');
        const msg = t('probeFound').replace('{servers}', serverList);

        if (!confirm(msg)) {
          els.toggleText.textContent = t('startServer');
          btn.disabled = false;
          return;
        }
      } else if (probe.error) {
        if (!confirm(t('probeError'))) {
          els.toggleText.textContent = t('startServer');
          btn.disabled = false;
          return;
        }
      }
      // ── End safety probe ────────────────────────────

      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const data = await res.json();

      if (data.error) {
        showToast(`Error: ${data.error}`);
        btn.disabled = false;
        return;
      }

      setRunningState(true);
      updateUI(data.status);
      connectSSE();
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }

  btn.disabled = false;
}

// ── UI Updates ─────────────────────────────────────────────

function setRunningState(running) {
  isRunning = running;

  els.toggleBtn.classList.toggle('running', running);
  els.toggleText.textContent = running ? t('stopServer') : t('startServer');
  els.toggleIcon.innerHTML = running
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';

  els.statusBadge.classList.toggle('running', running);
  els.statusText.textContent = running ? t('running') : t('stopped');

  const inputs = document.querySelectorAll('.config-grid input, .config-grid select');
  inputs.forEach(el => el.disabled = running);
}

function updateUI(status) {
  if (!status) return;
  setRunningState(status.running);

  if (status.config) {
    els.statServerIP.textContent = status.config.serverIP || '—';
  }
  if (status.pool) {
    els.statTotal.textContent = status.pool.total;
    els.statActive.textContent = status.pool.active;
    els.statAvailable.textContent = status.pool.available;
  }
  if (status.running) {
    connectSSE();
  }
}

function renderLeases(leases) {
  const tbody = els.leasesBody;
  els.leaseCount.textContent = leases.length;

  if (leases.length === 0) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${t('noLeases')}</td></tr>`;
    return;
  }

  tbody.innerHTML = leases.map(lease => {
    const statusClass = lease.expired ? 'expired' : 'active';
    const statusLabel = lease.expired ? t('expired') : t('active');
    const remaining = lease.expired ? '—' : formatDuration(lease.remaining);
    const assignedTime = new Date(lease.assignedAt).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });

    return `
      <tr>
        <td>${lease.mac}</td>
        <td style="color: var(--accent)">${lease.ip}</td>
        <td>${assignedTime}</td>
        <td>${remaining}</td>
        <td><span class="lease-status ${statusClass}">${statusLabel}</span></td>
      </tr>
    `;
  }).join('');
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── SSE Log Streaming ──────────────────────────────────────

function connectSSE() {
  if (sseSource) return;
  els.logContainer.innerHTML = '';

  sseSource = new EventSource('/api/logs');
  sseSource.onmessage = (event) => {
    try {
      appendLogEntry(JSON.parse(event.data));
    } catch (e) { /* ignore */ }
  };
  sseSource.onerror = () => { /* auto-reconnect */ };
}

function disconnectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
}

function appendLogEntry(entry) {
  const container = els.logContainer;
  const div = document.createElement('div');
  div.className = `log-entry log-${entry.level}`;

  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  div.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level">${entry.level.toUpperCase()}</span>
    <span class="log-msg">${escapeHTML(entry.message)}</span>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  while (container.children.length > 300) {
    container.removeChild(container.firstChild);
  }
}

function clearLogs() { els.logContainer.innerHTML = ''; }

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Auto Refresh ───────────────────────────────────────────

function startAutoRefresh() {
  refreshTimer = setInterval(() => {
    if (isRunning) { loadLeases(); loadStatus(); }
  }, 3000);
}

// ── Toast Notification ─────────────────────────────────────

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: rgba(17, 24, 39, 0.95);
    backdrop-filter: blur(12px);
    border: 1px solid var(--accent-red);
    color: var(--text-primary);
    padding: 12px 24px; border-radius: 10px;
    font-size: 0.85rem; font-family: var(--font-sans);
    z-index: 1000; opacity: 0;
    transition: all 0.3s ease;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
