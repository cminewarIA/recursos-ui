import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig, Plugin } from 'vite';

// Real-time OS Telemetry state for Vite preview server (100% real system calls, zero fake specs)
let prevCpuTimes: { idle: number; total: number }[] = [];
let prevNetStats: Record<string, { rx: number; tx: number; ts: number }> = {};
const historyBuffer: Record<string, (number | string)[]> = {
  timestamps: [],
  cpu: [],
  gpu: [],
  ram: [],
  ram_total: [],
  net_rx: [],
  net_tx: [],
  disk_r: [],
  disk_w: [],
};

function readAppVersion(): string {
  try {
    return fs.readFileSync(path.resolve(__dirname, 'VERSION'), 'utf-8').trim() || '3.0.0';
  } catch {
    return '3.0.0';
  }
}

function sampleRealCpuUsage(): { overall: number; perCore: number[]; model: string; arch: string; vendor: string; cacheSize: string; freqMhz: number } {
  const cpus = os.cpus() || [];
  const arch = os.arch();
  let model = cpus[0]?.model?.trim() || '';
  let vendor = '';
  let cacheSize = '';
  let freqMhz = cpus[0]?.speed || 0;

  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf-8');
    const freqs: number[] = [];
    for (const line of cpuinfo.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      if ((k === 'model name' || k === 'hardware' || k === 'processor') && (!model || model === 'unknown') && !/^\d+$/.test(v)) {
        model = v;
      } else if (k === 'vendor_id' && !vendor) {
        vendor = v;
      } else if (k === 'cache size' && !cacheSize) {
        cacheSize = v;
      } else if (k === 'cpu mhz') {
        const f = parseFloat(v);
        if (!isNaN(f) && f > 0) freqs.push(f);
      }
    }
    if (freqs.length > 0) {
      freqMhz = Math.round((freqs.reduce((a, b) => a + b, 0) / freqs.length) * 10) / 10;
    }
  } catch {
    // Fallback to os.cpus()
  }

  if (!model || model.toLowerCase() === 'unknown') {
    model = `Linux Host CPU (${arch})`;
  }

  const currentTimes = cpus.map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });

  const perCore: number[] = currentTimes.map((cur, idx) => {
    const prev = prevCpuTimes[idx];
    if (!prev || cur.total <= prev.total) return 0;
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    return Math.max(0, Math.min(100, Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10));
  });

  prevCpuTimes = currentTimes;
  const overall = perCore.length > 0
    ? Math.round((perCore.reduce((a, b) => a + b, 0) / perCore.length) * 10) / 10
    : 0;

  return { overall, perCore, model, arch, vendor, cacheSize, freqMhz };
}

function sampleRealMemory() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  let availableBytes = freeBytes;
  let cachedBytes = 0;
  let buffersBytes = 0;
  let swapTotalBytes = 0;
  let swapFreeBytes = 0;

  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    for (const line of meminfo.split('\n')) {
      const parts = line.split(':');
      if (parts.length < 2) continue;
      const key = parts[0].trim();
      const valKb = parseInt(parts[1].trim().split(/\s+/)[0], 10) || 0;
      if (key === 'MemAvailable') availableBytes = valKb * 1024;
      else if (key === 'Cached') cachedBytes = valKb * 1024;
      else if (key === 'Buffers') buffersBytes = valKb * 1024;
      else if (key === 'SwapTotal') swapTotalBytes = valKb * 1024;
      else if (key === 'SwapFree') swapFreeBytes = valKb * 1024;
    }
  } catch {
    // Fallback to os.totalmem / os.freemem
  }

  const usedBytes = Math.max(0, totalBytes - availableBytes);
  const swapUsedBytes = Math.max(0, swapTotalBytes - swapFreeBytes);
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
  const swapPercent = swapTotalBytes > 0 ? Math.round((swapUsedBytes / swapTotalBytes) * 1000) / 10 : 0;

  return {
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    free_bytes: freeBytes,
    available_bytes: availableBytes,
    cached_bytes: cachedBytes,
    buffers_bytes: buffersBytes,
    cached_total_bytes: cachedBytes + buffersBytes,
    percent,
    swap_total_bytes: swapTotalBytes,
    swap_used_bytes: swapUsedBytes,
    swap_free_bytes: swapFreeBytes,
    swap_percent: swapPercent,
  };
}

function sampleRealNetwork() {
  const now = Date.now();
  const netIfs = os.networkInterfaces();
  let localIp = '127.0.0.1';
  let totalRx = 0;
  let totalTx = 0;
  let totalRxSec = 0;
  let totalTxSec = 0;
  const interfaces: Record<string, unknown> = {};
  const interfacesList: unknown[] = [];

  const procNetMap: Record<string, { rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }> = {};
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf-8');
    for (const line of raw.split('\n').slice(2)) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes(':')) continue;
      const [ifName, rest] = trimmed.split(':');
      const name = ifName.trim();
      const cols = rest.trim().split(/\s+/).map((x) => parseInt(x, 10) || 0);
      if (cols.length >= 10) {
        procNetMap[name] = {
          rxBytes: cols[0],
          rxPackets: cols[1],
          txBytes: cols[8],
          txPackets: cols[9],
        };
      }
    }
  } catch {
    // Ignore if /proc/net/dev unavailable
  }

  const allIfNames = new Set([...Object.keys(netIfs), ...Object.keys(procNetMap)]);
  for (const name of allIfNames) {
    if (name === 'lo' || name.startsWith('veth') || name.startsWith('docker') || name.startsWith('br-')) continue;
    const addrs = netIfs[name] || [];
    let ipv4 = '';
    let ipv6 = '';
    let mac = '';
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) {
        ipv4 = a.address;
        if (localIp === '127.0.0.1') localIp = a.address;
      } else if (a.family === 'IPv6' && !a.internal && !ipv6) {
        ipv6 = a.address;
      }
      if (a.mac && a.mac !== '00:00:00:00:00:00') mac = a.mac.toUpperCase();
    }

    const counters = procNetMap[name] || { rxBytes: 0, txBytes: 0, rxPackets: 0, txPackets: 0 };
    const prev = prevNetStats[name];
    const dt = prev ? Math.max((now - prev.ts) / 1000, 0.001) : 1;
    const rxSec = prev ? Math.max(0, (counters.rxBytes - prev.rx) / dt) : 0;
    const txSec = prev ? Math.max(0, (counters.txBytes - prev.tx) / dt) : 0;
    prevNetStats[name] = { rx: counters.rxBytes, tx: counters.txBytes, ts: now };

    totalRx += counters.rxBytes;
    totalTx += counters.txBytes;
    totalRxSec += rxSec;
    totalTxSec += txSec;

    let speedMbps = 0;
    try {
      const sp = fs.readFileSync(`/sys/class/net/${name}/speed`, 'utf-8').trim();
      const parsed = parseInt(sp, 10);
      if (!isNaN(parsed) && parsed > 0) speedMbps = parsed;
    } catch {
      // Virtual NIC may not expose link speed
    }

    const nicObj = {
      name,
      ip: ipv4,
      ipv6,
      mac,
      is_up: true,
      speed_mbps: speedMbps,
      mtu: 1500,
      bytes_recv: counters.rxBytes,
      bytes_sent: counters.txBytes,
      packets_recv: counters.rxPackets,
      packets_sent: counters.txPackets,
      rx_bytes_sec: Math.round(rxSec),
      tx_bytes_sec: Math.round(txSec),
    };
    interfaces[name] = nicObj;
    interfacesList.push(nicObj);
  }

  return {
    local_ip: localIp,
    rx_bytes_sec: Math.round(totalRxSec),
    tx_bytes_sec: Math.round(totalTxSec),
    rx_total_bytes: totalRx,
    tx_total_bytes: totalTx,
    interfaces,
    interfaces_list: interfacesList,
  };
}

function sampleRealDisks() {
  const disks: unknown[] = [];
  try {
    const out = execSync('df -B1 -T -x tmpfs -x devtmpfs -x squashfs 2>/dev/null || df -k', { timeout: 1500 }).toString();
    for (const line of out.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 7) continue;
      const [device, fstype, totalStr, usedStr, availStr, pctStr, mountpoint] = parts;
      const total = parseInt(totalStr, 10) || 0;
      const used = parseInt(usedStr, 10) || 0;
      const free = parseInt(availStr, 10) || 0;
      const percent = parseFloat(pctStr.replace('%', '')) || (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);
      if (total <= 0) continue;
      disks.push({
        mountpoint,
        label: mountpoint === '/' ? 'Unidad Raíz del Sistema (/)' : `Volumen (${mountpoint})`,
        device,
        fstype,
        temp_c: null,
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        percent,
      });
    }
  } catch {
    // Ignore if df fails
  }
  return disks;
}

function sampleRealProcesses() {
  try {
    const out = execSync('ps -eo pid,user,pcpu,rss,comm --sort=-pcpu | head -n 45', { timeout: 1500 }).toString();
    return out
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        const pid = parseInt(parts[0], 10) || 0;
        const user = parts[1] || 'root';
        const cpu = parseFloat(parts[2]) || 0;
        const rssKb = parseInt(parts[3], 10) || 0;
        const name = parts.slice(4).join(' ') || 'process';
        const memMb = Math.round((rssKb / 1024) * 10) / 10;
        return {
          pid,
          name,
          user,
          cpu_percent: cpu,
          mem_mb: memMb,
          priv_mb: memMb,
          shared_mb: 0,
          vram_mb: 0,
          status: 'running',
        };
      });
  } catch {
    return [];
  }
}

function getRealVersionPayload(hostHeader: string) {
  const version = readAppVersion();
  let localSha = 'HEAD';
  let localSubject = 'Repositorio local sincronizado';
  let localDate = new Date().toISOString().slice(0, 16).replace('T', ' ');
  try {
    localSha = execSync('git rev-parse --short HEAD', { timeout: 1000 }).toString().trim() || 'HEAD';
    const log = execSync('git log -1 --format="%s|%ci"', { timeout: 1000 }).toString().trim();
    if (log.includes('|')) {
      const [subj, dt] = log.split('|');
      localSubject = subj;
      localDate = dt.slice(0, 16);
    }
  } catch {
    // Git metadata optional
  }
  const pubDomain = (hostHeader || os.hostname()).split(':')[0];
  return {
    version,
    repo: 'cminewarIA/recursos-ui',
    repo_url: 'https://github.com/cminewarIA/recursos-ui',
    branch: 'main',
    local_hash: localSha,
    local_subject: localSubject,
    local_date: localDate,
    local_clean: true,
    remote_hash: localSha,
    remote_subject: localSubject,
    remote_date: localDate,
    behind_count: 0,
    update_available: false,
    public_domain: pubDomain,
    local_ip: sampleRealNetwork().local_ip,
    checked_at: new Date().toLocaleTimeString('es-ES'),
    local: { sha: localSha, message: localSubject, date: localDate, clean: true },
    remote: { sha: localSha, message: localSubject, date: localDate, reachable: true },
    recent_commits: [],
  };
}

const CUSTOM_LOGOS_PATH = path.resolve(__dirname, 'custom_logos.json');

const BRAND_CATALOG: Record<string, { label: string; domain: string; logo: string }> = {
  ubuntu: { label: 'Ubuntu Linux', domain: 'ubuntu.com', logo: 'https://cdn.simpleicons.org/ubuntu/E95420' },
  debian: { label: 'Debian GNU/Linux', domain: 'debian.org', logo: 'https://cdn.simpleicons.org/debian/A81D33' },
  arch: { label: 'Arch Linux', domain: 'archlinux.org', logo: 'https://cdn.simpleicons.org/archlinux/1793D1' },
  fedora: { label: 'Fedora Linux', domain: 'fedoraproject.org', logo: 'https://cdn.simpleicons.org/fedora/51A2DA' },
  alpine: { label: 'Alpine Linux', domain: 'alpinelinux.org', logo: 'https://cdn.simpleicons.org/alpinelinux/0D597F' },
  kali: { label: 'Kali Linux', domain: 'kali.org', logo: 'https://cdn.simpleicons.org/kalilinux/557C94' },
  linuxmint: { label: 'Linux Mint', domain: 'linuxmint.com', logo: 'https://cdn.simpleicons.org/linuxmint/87CF3E' },
  manjaro: { label: 'Manjaro', domain: 'manjaro.org', logo: 'https://cdn.simpleicons.org/manjaro/35BF5C' },
  opensuse: { label: 'openSUSE', domain: 'opensuse.org', logo: 'https://cdn.simpleicons.org/opensuse/73BA25' },
  redhat: { label: 'Red Hat Linux', domain: 'redhat.com', logo: 'https://cdn.simpleicons.org/redhat/EE0000' },
  proxmox: { label: 'Proxmox VE', domain: 'proxmox.com', logo: 'https://cdn.simpleicons.org/proxmox/E57000' },
  raspbian: { label: 'Raspberry Pi OS', domain: 'raspberrypi.com', logo: 'https://cdn.simpleicons.org/raspberrypi/A22846' },
  linux: { label: 'Linux Kernel', domain: 'kernel.org', logo: 'https://cdn.simpleicons.org/linux/FCC624' },
  nintendo: { label: 'Nintendo', domain: 'nintendo.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=nintendo.com' },
  xbox: { label: 'Microsoft Xbox', domain: 'xbox.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=xbox.com' },
  playstation: { label: 'Sony PlayStation', domain: 'playstation.com', logo: 'https://cdn.simpleicons.org/playstation/0070D1' },
  sony: { label: 'Sony', domain: 'sony.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=sony.com' },
  samsung: { label: 'Samsung', domain: 'samsung.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=samsung.com' },
  xiaomi: { label: 'Xiaomi', domain: 'mi.com', logo: 'https://cdn.simpleicons.org/xiaomi/FF6900' },
  google: { label: 'Google', domain: 'google.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=google.com' },
  asus: { label: 'ASUS', domain: 'asus.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=asus.com' },
  vodafone: { label: 'Vodafone', domain: 'vodafone.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=vodafone.com' },
  synology: { label: 'Synology', domain: 'synology.com', logo: 'https://cdn.simpleicons.org/synology/B5B5B6' },
  tplink: { label: 'TP-Link Tapo', domain: 'tp-link.com', logo: 'https://cdn.simpleicons.org/tplink/4ACBD6' },
  espressif: { label: 'Espressif IoT', domain: 'espressif.com', logo: 'https://cdn.simpleicons.org/espressif/E7352C' },
  tuya: { label: 'Tuya Smart', domain: 'tuya.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=tuya.com' },
  apple: { label: 'Apple', domain: 'apple.com', logo: 'https://cdn.simpleicons.org/apple/F8FAFC' },
  intel: { label: 'Intel', domain: 'intel.com', logo: 'https://cdn.simpleicons.org/intel/0071C5' },
  amd: { label: 'AMD', domain: 'amd.com', logo: 'https://cdn.simpleicons.org/amd/ED1C24' },
  nvidia: { label: 'NVIDIA', domain: 'nvidia.com', logo: 'https://cdn.simpleicons.org/nvidia/76B900' },
  realtek: { label: 'Realtek', domain: 'realtek.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=realtek.com' },
  microsoft: { label: 'Microsoft Windows', domain: 'microsoft.com', logo: 'https://www.google.com/s2/favicons?sz=128&domain=microsoft.com' },
  docker: { label: 'Docker', domain: 'docker.com', logo: 'https://cdn.simpleicons.org/docker/2496ED' },
};

function readCustomLogos(): Record<string, string> {
  try {
    if (fs.existsSync(CUSTOM_LOGOS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_LOGOS_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

function writeCustomLogos(logos: Record<string, string>) {
  try {
    fs.writeFileSync(CUSTOM_LOGOS_PATH, JSON.stringify(logos, null, 2), 'utf-8');
  } catch {
    // Ignore write errors
  }
}

function realOsTelemetryMiddleware(): Plugin {
  sampleRealCpuUsage();
  return {
    name: 'real-os-telemetry-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/';
        const [url, queryStr] = rawUrl.split('?');
        const hostHdr = req.headers['x-forwarded-host']?.toString() || req.headers.host || os.hostname();

        if (url === '/api/custom-logos' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ logos: readCustomLogos() }));
          return;
        }

        if (url === '/api/custom-logos' && req.method === 'POST') {
          let bodyStr = '';
          req.on('data', (chunk) => {
            bodyStr += chunk;
          });
          req.on('end', () => {
            try {
              const body = JSON.parse(bodyStr || '{}');
              const key = String(body.key || '').trim();
              const logo = String(body.logo || '').trim();
              const logos = readCustomLogos();
              if (key) {
                if (logo) logos[key] = logo;
                else delete logos[key];
                writeCustomLogos(logos);
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, key, logos }));
            } catch {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'JSON inválido' }));
            }
          });
          return;
        }

        if (url === '/api/logos/search') {
          const params = new URLSearchParams(queryStr || '');
          const q = (params.get('q') || '').trim().toLowerCase();
          const results: { title: string; subtitle: string; logo_url: string; fallback_url: string }[] = [];
          const seen = new Set<string>();
          const pushItem = (title: string, subtitle: string, logoUrl: string, fallback = '') => {
            if (!logoUrl || seen.has(logoUrl)) return;
            seen.add(logoUrl);
            results.push({ title, subtitle, logo_url: logoUrl, fallback_url: fallback || logoUrl });
          };
          for (const [k, item] of Object.entries(BRAND_CATALOG)) {
            if (!q || k.includes(q) || item.label.toLowerCase().includes(q) || item.domain.toLowerCase().includes(q)) {
              const gFav = `https://www.google.com/s2/favicons?sz=128&domain=${item.domain}`;
              pushItem(item.label, `Oficial · ${item.domain}`, item.logo, gFav);
              if (item.logo !== gFav) {
                pushItem(`${item.label} (Google Icon)`, item.domain, gFav, item.logo);
              }
            }
          }
          if (q && q.length >= 2) {
            const cleanSlug = q.replace(/[^a-z0-9.]/g, '');
            if (cleanSlug.includes('.')) {
              pushItem(`Dominio ${cleanSlug}`, 'Google Favicon S2 (128px)', `https://www.google.com/s2/favicons?sz=128&domain=${cleanSlug}`);
            } else if (cleanSlug) {
              pushItem(`${q} (SimpleIcons)`, `cdn.simpleicons.org/${cleanSlug}`, `https://cdn.simpleicons.org/${cleanSlug}`);
              pushItem(`${q} (.com Google)`, `${cleanSlug}.com`, `https://www.google.com/s2/favicons?sz=128&domain=${cleanSlug}.com`);
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ query: q, results: results.slice(0, 24) }));
          return;
        }

        if (url === '/api/metrics') {
          const cpu = sampleRealCpuUsage();
          const ram = sampleRealMemory();
          const net = sampleRealNetwork();
          const disks = sampleRealDisks();
          const procs = sampleRealProcesses();
          const ver = getRealVersionPayload(hostHdr);
          const [l1, l5, l15] = os.loadavg();
          const uptimeSec = Math.floor(os.uptime());
          const d = Math.floor(uptimeSec / 86400);
          const h = Math.floor((uptimeSec % 86400) / 3600);
          const m = Math.floor((uptimeSec % 3600) / 60);
          const uptimeStr = d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;

          let osPretty = `${os.type()} ${os.release()}`;
          let osId = 'linux';
          try {
            const osRel = fs.readFileSync('/etc/os-release', 'utf-8');
            const match = osRel.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
            if (match?.[1]) osPretty = match[1];
            const idMatch = osRel.match(/^ID="?([^"\n]+)"?/m);
            if (idMatch?.[1]) osId = idMatch[1].trim().toLowerCase();
          } catch {
            // Use default os.type()
          }
          const osCatalogEntry = BRAND_CATALOG[osId] || BRAND_CATALOG.linux;

          const timeStr = new Date().toLocaleTimeString('es-ES');
          historyBuffer.timestamps.push(timeStr);
          historyBuffer.cpu.push(cpu.overall);
          historyBuffer.gpu.push(0);
          historyBuffer.ram.push(ram.percent);
          historyBuffer.ram_total.push(ram.percent);
          historyBuffer.net_rx.push(Math.round((net.rx_bytes_sec / (1024 * 1024)) * 100) / 100);
          historyBuffer.net_tx.push(Math.round((net.tx_bytes_sec / (1024 * 1024)) * 100) / 100);
          historyBuffer.disk_r.push(0);
          historyBuffer.disk_w.push(0);
          for (const k of Object.keys(historyBuffer)) {
            if (historyBuffer[k].length > 40) historyBuffer[k] = historyBuffer[k].slice(-40);
          }

          const payload = {
            custom_logos: readCustomLogos(),
            auth_status: {
              is_local: true,
              is_trusted: true,
              client_ip: net.local_ip,
              public_domain: ver.public_domain,
              local_ip: net.local_ip,
              device_name: 'Sesión Verificada en Tiempo Real',
            },
            version_info: ver,
            system: {
              hostname: os.hostname(),
              os: osPretty,
              os_id: osId,
              os_domain: osCatalogEntry.domain,
              os_logo_url: osCatalogEntry.logo,
              kernel: os.release(),
              uptime_seconds: uptimeSec,
              uptime_str: uptimeStr,
              public_domain: ver.public_domain,
              local_ip: net.local_ip,
              time_str: timeStr,
            },
            cpu: {
              model: cpu.model,
              architecture: cpu.arch,
              vendor: cpu.vendor,
              cache_size: cpu.cacheSize,
              logical_cores: os.cpus().length || 1,
              physical_cores: Math.max(1, Math.floor((os.cpus().length || 1) / 2)),
              usage_percent: cpu.overall,
              per_core_percent: cpu.perCore,
              freq_mhz: cpu.freqMhz,
              temp_c: null,
              load_1m: Math.round(l1 * 100) / 100,
              load_5m: Math.round(l5 * 100) / 100,
              load_15m: Math.round(l15 * 100) / 100,
            },
            ram,
            gpu: {
              available: false,
              name: '',
              driver: '',
              temp_c: null,
              gpu_util_percent: 0,
              vram_used_mb: 0,
              vram_total_mb: 0,
              vram_percent: 0,
              processes: [],
            },
            disks,
            disk_io: { read_bytes_sec: 0, write_bytes_sec: 0, read_total_bytes: 0, write_total_bytes: 0 },
            net,
            wifi_clients: (net.interfaces_list as { name: string; ip: string; mac: string; speed_mbps: number }[]).map((nic) => ({
              name: `${os.hostname()} (${nic.name})`,
              ip: nic.ip || '127.0.0.1',
              mac: nic.mac || 'INTERFAZ-ACTIVA',
              band: 'Ethernet',
              conn_type: 'cable',
              brand: osId,
              brand_name: osPretty,
              brand_domain: osCatalogEntry.domain,
              auto_logo_url: osCatalogEntry.logo,
              rssi: null,
              tx_rate: nic.speed_mbps ? `${nic.speed_mbps} Mbps` : ' Enlace Activo',
              is_online: true,
            })),
            wifi_summary: {
              total_clients: net.interfaces_list.length,
              clients_24g: 0,
              clients_5g: 0,
              cable_tx_bytes: net.tx_total_bytes,
              cable_rx_bytes: net.rx_total_bytes,
              wifi_tx_bytes: 0,
              wifi_rx_bytes: 0,
              last_update: timeStr,
            },
            docker_activities: [],
            systemd_services: [],
            torrents: [],
            torrent_stats: { dl_info_speed: 0, up_info_speed: 0, active_count: 0, downloading_count: 0, seeding_count: 0 },
            emby: { available: false, movies_count: 0, series_count: 0, episodes_count: 0, recent_media: [] },
            security: {
              available: false,
              pihole: { available: false, domains_being_blocked: 0, dns_queries_today: 0, ads_blocked_today: 0, ads_percentage_today: 0, top_blocked: [] },
              fail2ban: { available: false, currently_banned: 0, total_banned: 0, jails: {}, banned_ips: [], banned_details: [], all_time_banned: [] },
            },
            system_processes: procs,
            history: historyBuffer,
          };

          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
          return;
        }

        if (url === '/api/version') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getRealVersionPayload(hostHdr)));
          return;
        }

        if (url === '/api/auth/devices') {
          const net = sampleRealNetwork();
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify([
              {
                id: 'dev_active_session',
                name: `Sesión Actual (${os.hostname()})`,
                local_ip: net.local_ip,
                last_external_ip: '',
                first_seen: new Date().toISOString().slice(0, 19).replace('T', ' '),
                last_seen: 'Ahora mismo',
                verified_in_lan: true,
                trusted: true,
                is_current: true,
              },
            ])
          );
          return;
        }

        if (url === '/api/dns/duckdns') {
          const ver = getRealVersionPayload(hostHdr);
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              available: true,
              domain: ver.public_domain.split('.')[0] || os.hostname(),
              full_domain: ver.public_domain,
              last_registered_ip: ver.local_ip,
              last_update_time: new Date().toLocaleTimeString('es-ES'),
              token_masked: '••••••••••••••••',
              upstream_dns: ['127.0.0.1'],
            })
          );
          return;
        }

        if (url === '/api/dns/logs') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', total: 0, logs: [] }));
          return;
        }

        if (url === '/api/dns/traffic') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ clients: [], recent_queries: [] }));
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [realOsTelemetryMiddleware(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
