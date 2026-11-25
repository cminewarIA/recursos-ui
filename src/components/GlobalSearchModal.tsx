import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  BookOpen,
  Bot,
  Box,
  Cpu,
  Download,
  Gauge,
  Globe,
  HardDrive,
  Home,
  Layers,
  MapPin,
  Network,
  Palette,
  Search,
  Server,
  Shield,
  Terminal,
  Wifi,
  X,
} from 'lucide-react';
import { COCKPIT_SPRING } from './MotionPrimitives';
import { MainTabId, MetricsPayload } from '../types/telemetry';
import { formatCanonicalRoute } from '../utils/formatters';
import { useI18n } from '../i18n';

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: MainTabId, subTab?: string) => void;
  metrics: MetricsPayload | null;
}

interface SearchItem {
  id: string;
  title: string;
  category: string;
  tab: MainTabId;
  subTab?: string;
  icon: React.ReactNode;
  hint?: string;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  metrics,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const baseItems: SearchItem[] = useMemo(
    () => [
      {
        id: 'nav-inicio',
        title: t('nav.inicio'),
        category: t('search.cat_views'),
        tab: 'inicio',
        icon: <Home className="h-4 w-4 text-[#1e6b38] dark:text-[#c6f19d]" />,
        hint: 'HUD · KPIs · 5m',
      },
      {
        id: 'nav-cpu',
        title: t('equipment.sort_cpu'),
        category: t('nav.equipo'),
        tab: 'equipo',
        subTab: 'cpu',
        icon: <Cpu className="h-4 w-4 text-sky-500" />,
        hint: metrics?.cpu?.model || 'CPU',
      },
      {
        id: 'nav-ram',
        title: t('hardware.ram.short_title'),
        category: t('nav.equipo'),
        tab: 'equipo',
        subTab: 'ram',
        icon: <Layers className="h-4 w-4 text-emerald-500" />,
        hint: 'RAM · Cache · Swap',
      },
      {
        id: 'nav-gpu',
        title: t('hardware.gpu.short_title'),
        category: t('nav.equipo'),
        tab: 'equipo',
        subTab: 'gpu',
        icon: <Activity className="h-4 w-4 text-purple-500" />,
        hint: metrics?.gpu?.name || 'VRAM · 3D',
      },
      {
        id: 'nav-storage',
        title: t('hardware.storage.title'),
        category: t('nav.equipo'),
        tab: 'equipo',
        subTab: 'storage',
        icon: <HardDrive className="h-4 w-4 text-amber-500" />,
        hint: 'NVMe · SATA · NAS',
      },
      {
        id: 'nav-processes',
        title: t('apps.subtabs.processes'),
        category: t('nav.programas'),
        tab: 'programas',
        subTab: 'processes',
        icon: <Terminal className="h-4 w-4 text-indigo-500" />,
        hint: '24h · PID',
      },
      {
        id: 'nav-containers',
        title: t('apps.subtabs.containers'),
        category: t('nav.programas'),
        tab: 'programas',
        subTab: 'containers',
        icon: <Box className="h-4 w-4 text-blue-500" />,
        hint: 'Docker',
      },
      {
        id: 'nav-services',
        title: t('apps.subtabs.services'),
        category: t('nav.programas'),
        tab: 'programas',
        subTab: 'services',
        icon: <Server className="h-4 w-4 text-slate-500" />,
        hint: 'Systemd',
      },
      {
        id: 'nav-media',
        title: t('apps.subtabs.media'),
        category: t('nav.programas'),
        tab: 'programas',
        subTab: 'media',
        icon: <Download className="h-4 w-4 text-teal-500" />,
        hint: 'Emby · qBittorrent',
      },
      {
        id: 'nav-bots',
        title: t('apps.subtabs.bots'),
        category: t('nav.programas'),
        tab: 'programas',
        subTab: 'bots',
        icon: <Bot className="h-4 w-4 text-sky-400" />,
        hint: 'Telegram',
      },
      {
        id: 'nav-net-home',
        title: t('network.subtabs.home'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'home',
        icon: <Wifi className="h-4 w-4 text-[#1e6b38] dark:text-[#c6f19d]" />,
        hint: 'LAN · NICs · Ping',
      },
      {
        id: 'nav-traffic',
        title: t('network.subtabs.traffic'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'traffic',
        icon: <Layers className="h-4 w-4 text-violet-500" />,
        hint: '24h · DNS · Pi-hole',
      },
      {
        id: 'nav-map',
        title: t('network.subtabs.map'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'map',
        icon: <MapPin className="h-4 w-4 text-emerald-500" />,
        hint: 'GeoIP · Leaflet',
      },
      {
        id: 'nav-speedtest',
        title: t('network.subtabs.speedtest'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'speedtest',
        icon: <Gauge className="h-4 w-4 text-amber-500" />,
        hint: 'Speedtest.net · SQLite',
      },
      {
        id: 'nav-security',
        title: t('network.subtabs.security'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'security',
        icon: <Shield className="h-4 w-4 text-rose-500" />,
        hint: 'Fail2ban',
      },
      {
        id: 'nav-dns',
        title: t('network.subtabs.dns'),
        category: t('nav.red'),
        tab: 'red',
        subTab: 'dns',
        icon: <Globe className="h-4 w-4 text-cyan-500" />,
        hint: 'DuckDNS · DDNS',
      },
      {
        id: 'nav-updates',
        title: t('more.subtabs.updates'),
        category: t('nav.mas'),
        tab: 'mas',
        subTab: 'updates',
        icon: <Download className="h-4 w-4 text-blue-400" />,
        hint: 'OTA · Idiomas · Logs',
      },
      {
        id: 'nav-themes',
        title: t('more.subtabs.themes'),
        category: t('nav.mas'),
        tab: 'mas',
        subTab: 'themes',
        icon: <Palette className="h-4 w-4 text-emerald-500" />,
        hint: 'Matrix · OTA · JSON',
      },
      {
        id: 'nav-more-devices',
        title: t('more.subtabs.devices'),
        category: t('nav.mas'),
        tab: 'mas',
        subTab: 'devices',
        icon: <Shield className="h-4 w-4 text-rose-400" />,
        hint: 'HMAC · Tokens',
      },
      {
        id: 'nav-manual',
        title: t('more.subtabs.manual'),
        category: t('nav.mas'),
        tab: 'mas',
        subTab: 'manual',
        icon: <BookOpen className="h-4 w-4 text-emerald-500" />,
        hint: 'Docs',
      },
    ],
    [t, metrics?.cpu?.model, metrics?.gpu?.name]
  );

  // Dynamic live search items (processes, LAN devices, Docker containers)
  const dynamicItems: SearchItem[] = useMemo(() => {
    const list: SearchItem[] = [];
    if (!metrics) return list;

    const procs = metrics.system_processes ?? [];
    for (const p of procs.slice(0, 15)) {
      list.push({
        id: `proc-${p.pid}`,
        title: `${p.name} (PID ${p.pid})`,
        category: t('apps.subtabs.processes'),
        tab: 'programas',
        subTab: 'processes',
        icon: <Terminal className="h-4 w-4 text-indigo-400" />,
        hint: p.cpu_percent !== undefined ? `${Number(p.cpu_percent).toFixed(1)}% CPU` : undefined,
      });
    }

    const clients = metrics.wifi_clients ?? [];
    for (const c of clients.slice(0, 15)) {
      list.push({
        id: `dev-${c.ip || c.mac}`,
        title: c.name || c.hostname || c.ip || c.mac || 'Device',
        category: t('network.subtabs.home'),
        tab: 'red',
        subTab: 'home',
        icon: <Network className="h-4 w-4 text-cyan-400" />,
        hint: [c.ip, c.mac].filter(Boolean).join(' · '),
      });
    }

    const containers = metrics.docker_activities ?? [];
    for (const d of containers.slice(0, 10)) {
      list.push({
        id: `docker-${d.name}`,
        title: d.name,
        category: 'Docker',
        tab: 'programas',
        subTab: 'containers',
        icon: <Box className="h-4 w-4 text-blue-400" />,
        hint: [d.state, d.image].filter(Boolean).join(' · '),
      });
    }

    return list;
  }, [metrics, t]);

  const allItems = useMemo(() => [...baseItems, ...dynamicItems], [baseItems, dynamicItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return baseItems;
    return allItems
      .filter((item) => {
        const routePath = formatCanonicalRoute(item.tab, item.subTab).toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          routePath.includes(q) ||
          (item.hint && item.hint.toLowerCase().includes(q))
        );
      })
      .slice(0, 20);
  }, [allItems, baseItems, query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = filteredItems[selectedIndex];
      if (chosen) {
        onNavigate(chosen.tab, chosen.subTab);
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelectItem = (item: SearchItem) => {
    onNavigate(item.tab, item.subTab);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6 md:p-20 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.95, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -16 }}
            transition={COCKPIT_SPRING}
            className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-[#0f1f10] border border-slate-200/80 dark:border-slate-800 shadow-2xl overflow-hidden z-10"
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200/70 dark:border-slate-800/80">
              <Search className="h-5 w-5 text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t('search.placeholder')}
                className="w-full bg-transparent text-sm sm:text-base font-medium text-slate-900 dark:text-[#f5f4f2] placeholder:text-slate-400 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-[10px] text-slate-400">
                ESC
              </kbd>
            </div>

            <div className="max-h-[min(65vh,480px)] overflow-y-auto p-2 divide-y divide-slate-100 dark:divide-slate-800/40">
              {filteredItems.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  {t('search.no_results', { query })}
                </div>
              ) : (
                filteredItems.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const routeUrl = formatCanonicalRoute(item.tab, item.subTab);
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#1e6b38]/10 dark:bg-[#c6f19d]/10 text-slate-900 dark:text-[#f5f4f2]'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`p-2 rounded-lg shrink-0 ${
                            isSelected ? 'bg-white dark:bg-[#0a140b] shadow-sm' : 'bg-slate-100 dark:bg-slate-800/60'
                          }`}
                        >
                          {item.icon}
                        </div>
                        <div className="min-w-0">
                          <span className="block text-sm font-semibold truncate">{item.title}</span>
                          <span className="block text-[11px] font-mono text-slate-400 truncate">
                            {item.category}
                            {item.hint ? ` · ${item.hint}` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {routeUrl}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/80 dark:bg-[#0a140b]/80 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px] font-mono text-slate-400">
              <div className="flex items-center gap-3">
                <span>{t('search.nav_hint')}</span>
                <span>{t('search.select_hint')}</span>
              </div>
              <span className="text-[#1e6b38] dark:text-[#c6f19d] font-semibold tabular-nums">
                {t('search.options_count', { count: filteredItems.length })}
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
