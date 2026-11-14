import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutGroup, motion } from 'motion/react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  GitCommit,
  Laptop,
  Lock,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Usb,
} from 'lucide-react';
import { MorphPill, ViewStage } from './MotionPrimitives';
import {
  DexStatusPayload,
  MetricsPayload,
  SystemErrorLogEntry,
  ThemeMode,
  TrustedDevice,
  VersionInfo,
} from '../types/telemetry';
import { apiFetchJson, detectNativeEnvironment } from '../utils/api';
import { getDisplayVersionString } from '../utils/formatters';

type MoreSubTab = 'updates' | 'devices' | 'manual' | 'dex';

function resolveMoreSubTab(hint?: string): MoreSubTab | undefined {
  if (!hint) return undefined;
  const h = hint.toLowerCase();
  if (h === 'updates' || h === 'logs' || h === 'sistema' || h === 'version') return 'updates';
  if (h === 'devices' || h === 'dispositivos' || h === 'nodos') return 'devices';
  if (h === 'manual' || h === 'readme' || h === 'ayuda' || h === 'docs') return 'manual';
  if (h === 'dex') return 'dex';
  return undefined;
}

interface MoreViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onChangeTheme: (next: ThemeMode) => void;
  initialSubTab?: string;
  navTick?: number;
  onRefreshMetrics: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  metrics,
  theme,
  onChangeTheme,
  initialSubTab,
  navTick,
  onRefreshMetrics,
  onNotify,
}) => {
  const { isUbuntuNative, isNativeApp } = detectNativeEnvironment();
  const [subTab, setSubTab] = useState<MoreSubTab>(() => resolveMoreSubTab(initialSubTab) || 'updates');
  const manualIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    try {
      manualIframeRef.current?.contentWindow?.postMessage({ type: 'RECURSOS_THEME', theme }, '*');
    } catch {
      // ignore cross-origin frame message errors
    }
  }, [theme]);

  // Updates state
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(metrics?.version_info ?? null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateOutput, setUpdateOutput] = useState('');
  const [showTechUpdate, setShowTechUpdate] = useState(() => initialSubTab?.toLowerCase() === 'logs');
  const [sysLogs, setSysLogs] = useState<SystemErrorLogEntry[]>([]);

  useEffect(() => {
    const mapped = resolveMoreSubTab(initialSubTab);
    if (mapped) {
      setSubTab(mapped);
      if (initialSubTab?.toLowerCase() === 'logs') {
        setShowTechUpdate(true);
      }
    }
  }, [initialSubTab, navTick]);

  // Devices state
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState('');
  const [expandedDevId, setExpandedDevId] = useState<string | null>(null);

  // DeX USB state (Ubuntu Native only)
  const [dexStatus, setDexStatus] = useState<DexStatusPayload | null>(null);
  const [dexResolution, setDexResolution] = useState('1920x1080');
  const [dexFps, setDexFps] = useState(60);
  const [dexFullscreen, setDexFullscreen] = useState(false);

  const loadVersion = useCallback(async (force = false) => {
    setCheckingUpdate(true);
    const res = await apiFetchJson<VersionInfo>(`/api/version${force ? '?refresh=1' : ''}`);
    setCheckingUpdate(false);
    if (res.ok && res.data) setVersionInfo(res.data);
  }, []);

  const loadDevices = useCallback(async () => {
    const res = await apiFetchJson<TrustedDevice[]>('/api/auth/devices');
    if (res.ok && Array.isArray(res.data)) setDevices(res.data);
  }, []);

  const loadDex = useCallback(async () => {
    if (!isUbuntuNative) return;
    const res = await apiFetchJson<DexStatusPayload>('/api/dex/status');
    if (res.ok && res.data) setDexStatus(res.data);
  }, [isUbuntuNative]);

  const loadLogs = useCallback(async () => {
    const res = await apiFetchJson<{ logs?: SystemErrorLogEntry[] }>('/api/system/logs?limit=25');
    if (res.ok && Array.isArray(res.data?.logs)) setSysLogs(res.data.logs);
  }, []);

  useEffect(() => {
    if (metrics?.version_info && !versionInfo) setVersionInfo(metrics.version_info);
  }, [metrics?.version_info, versionInfo]);

  useEffect(() => {
    if (subTab === 'updates') {
      void loadVersion(false);
      void loadLogs();
    } else if (subTab === 'devices') {
      void loadDevices();
    } else if (subTab === 'dex') {
      void loadDex();
    }
  }, [subTab, loadVersion, loadLogs, loadDevices, loadDex]);

  const activeVer = versionInfo || metrics?.version_info;
  const displayVer = getDisplayVersionString(activeVer?.current_version, activeVer?.display_version);
  const remoteDisplayVer = activeVer?.remote_display_version || getDisplayVersionString(activeVer?.remote_version);

  const handleApplyUpdate = async () => {
    setInstallingUpdate(true);
    const res = await apiFetchJson<{
      success?: boolean;
      deb_installed?: boolean;
      web_synced?: boolean;
      message?: string;
      output?: string;
      version_info?: VersionInfo;
    }>('/api/system/update', { method: 'POST' });
    setInstallingUpdate(false);
    if (res.data?.output) setUpdateOutput(res.data.output);
    if (res.data?.version_info) setVersionInfo(res.data.version_info);
    if (res.ok && res.data?.success !== false) {
      onNotify(res.data?.message || 'Sistema comprobado y actualizado correctamente.');
      onRefreshMetrics();
      if (res.data?.web_synced) {
        setTimeout(() => {
          window.location.reload();
        }, 900);
      }
    } else {
      onNotify(res.error || res.data?.message || 'No se pudo completar la actualización automática.', true);
    }
  };

  const handleToggleAutoUpdate = async () => {
    const next = !(activeVer?.auto_install_enabled ?? true);
    const res = await apiFetchJson<{ auto_install_enabled?: boolean; status?: string }>('/api/system/auto-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) {
      setVersionInfo((prev) =>
        prev
          ? {
              ...prev,
              auto_install_enabled: res.data?.auto_install_enabled ?? next,
              auto_install_status: res.data?.status || prev.auto_install_status,
            }
          : prev
      );
      onNotify(next ? 'Instalación automática desde GitHub activada.' : 'Instalación automática pausada.');
    }
  };

  const handleSaveAlias = async (devId: string) => {
    const res = await apiFetchJson('/api/auth/rename-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: devId, alias: aliasDraft.trim() }),
    });
    if (res.ok) {
      setEditingId(null);
      onNotify('Nombre guardado.');
      void loadDevices();
    } else {
      onNotify(res.error || 'No se pudo cambiar el nombre.', true);
    }
  };

  const handleRevokeDevice = async (devId: string) => {
    const res = await apiFetchJson('/api/auth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: devId }),
    });
    if (res.ok) {
      onNotify('Dispositivo desconectado.');
      void loadDevices();
    }
  };

  const handleRevokeAllOthers = async () => {
    const res = await apiFetchJson<{ revoked_count?: number }>('/api/auth/revoke_all_others', { method: 'POST' });
    if (res.ok) {
      onNotify(`Se desconectaron ${res.data?.revoked_count ?? 0} dispositivos.`);
      void loadDevices();
    }
  };

  const handleDexAction = async (start: boolean, serial?: string) => {
    const res = await apiFetchJson<{ success?: boolean; session_running?: boolean; error?: string }>(
      start ? '/api/dex/start' : '/api/dex/stop',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serial: serial || '', resolution: dexResolution, max_fps: dexFps, fullscreen: dexFullscreen }),
      }
    );
    if (res.ok && res.data?.success) {
      onNotify(start ? 'Proyección USB iniciada.' : 'Proyección USB detenida.');
      void loadDex();
    } else {
      onNotify(res.data?.error || res.error || 'No se pudo controlar la proyección USB.', true);
    }
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation */}
      <LayoutGroup id="more-subtabs">
        <div className="cockpit-segmented flex items-center gap-1.5 overflow-x-auto p-1.5 no-scrollbar">
          {[
            { id: 'updates' as const, label: 'Actualizaciones y aspecto', icon: <GitCommit className="h-4 w-4" /> },
            { id: 'devices' as const, label: 'Dispositivos conectados', icon: <ShieldCheck className="h-4 w-4" /> },
            { id: 'manual' as const, label: 'Manual interactivo', icon: <BookOpen className="h-4 w-4" /> },
            ...(isUbuntuNative
              ? [{ id: 'dex' as const, label: 'Pantalla móvil USB', icon: <Usb className="h-4 w-4" /> }]
              : []),
          ].map((t) => {
            const active = subTab === t.id;
            return (
              <motion.button
                whileTap={{ scale: 0.97 }}
                key={t.id}
                type="button"
                onClick={() => setSubTab(t.id)}
                className={`relative inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-sky-700 dark:text-sky-300'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {active && <MorphPill layoutId="more-subtab-pill" className="rounded-xl" />}
                <span className="relative z-10 inline-flex items-center gap-2">
                  {t.icon}
                  <span>{t.label}</span>
                </span>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>

      <ViewStage tabKey={subTab}>
      {/* 1. Actualizaciones y aspecto (Selector de Tema Claro/Oscuro integrado aquí) */}
      {subTab === 'updates' && (
        <div className="space-y-4">
          {/* Theme Switcher inside GitHub Updater Panel */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Aspecto visual del panel
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cambia al instante entre el diseño claro minimalista y el modo oscuro en web y apps
                </p>
              </div>
              <LayoutGroup id="theme-switcher">
                <div className="cockpit-subtile inline-flex items-center gap-1 p-1 shrink-0">
                  {(['light', 'dark'] as const).map((mode) => {
                    const active = theme === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onChangeTheme(mode)}
                        className={`relative inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                          active
                            ? 'text-sky-700 dark:text-sky-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                        }`}
                      >
                        {active && <MorphPill layoutId="theme-switcher-pill" className="rounded-lg" />}
                        <span className="relative z-10 inline-flex items-center gap-2">
                          {mode === 'light' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                          <span>{mode === 'light' ? 'Claro' : 'Oscuro'}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </LayoutGroup>
            </div>
          </section>

          {/* Unified App / Server / GitHub Updater */}
          <section className="cockpit-bento p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {isUbuntuNative ? 'Actualización unificada' : 'Actualizaciones desde GitHub'}
                  </h2>
                  <span className="cockpit-pill-cyan rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold">
                    v{displayVer}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.update_summary
                    ? activeVer.update_summary
                    : activeVer?.update_available
                      ? `Hay una versión nueva disponible (v${remoteDisplayVer}).`
                      : activeVer?.ahead_of_remote
                        ? 'Tienes cambios locales más recientes que el repositorio.'
                        : 'Tu sistema está al día con la última versión.'}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.auto_install_status || 'Actualización automática activada'}
                </p>

                {(activeVer?.ubuntu_native_bridge || activeVer?.app_version || activeVer?.server_version) && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="cockpit-subtile px-3 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        App Ubuntu
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                        v{getDisplayVersionString(activeVer.app_version || activeVer.current_version, activeVer.app_display_version)}
                        {activeVer.app_above_github && (
                          <span className="ml-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            · sup. GitHub
                          </span>
                        )}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl px-3 py-2.5 ${
                        activeVer.server_needs_update
                          ? 'cockpit-pill-cyan'
                          : 'cockpit-subtile'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider opacity-75">
                        Servidor web local
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold">
                        {activeVer.server_reachable === false
                          ? 'Sin conexión'
                          : `v${getDisplayVersionString(
                              activeVer.server_version || activeVer.current_version,
                              activeVer.server_display_version
                            )}`}
                        {activeVer.server_needs_update && (
                          <span className="ml-1.5 text-[10px] font-medium text-sky-600 dark:text-sky-300">
                            · actualizable
                          </span>
                        )}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl px-3 py-2.5 ${
                        activeVer.github_above_app || activeVer.github_above_server
                          ? 'cockpit-pill-emerald'
                          : 'cockpit-subtile'
                      }`}
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider opacity-75">
                        GitHub oficial
                      </p>
                      <p className="mt-0.5 font-mono text-xs font-semibold">
                        {remoteDisplayVer && remoteDisplayVer !== '0.0.0' ? `v${remoteDisplayVer}` : 'Sin acceso'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleAutoUpdate}
                  className={`min-h-[44px] rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                    activeVer?.auto_install_enabled
                      ? 'cockpit-pill-emerald'
                      : 'cockpit-subtile text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {activeVer?.auto_install_enabled ? 'Autoactualización activada' : 'Autoactualización pausada'}
                </button>
                <button
                  type="button"
                  disabled={checkingUpdate}
                  onClick={() => loadVersion(true)}
                  className="cockpit-subtile inline-flex min-h-[44px] items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                  <span>Comprobar</span>
                </button>
                <button
                  type="button"
                  disabled={installingUpdate}
                  onClick={handleApplyUpdate}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
                    activeVer?.effective_update_available || activeVer?.update_available
                      ? 'cockpit-btn-accent'
                      : 'cockpit-subtile text-slate-800 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>
                    {installingUpdate
                      ? 'Actualizando...'
                      : activeVer?.update_action_label || 'Actualizar ahora'}
                  </span>
                </button>
              </div>
            </div>

            {activeVer?.recent_commits && activeVer.recent_commits.length > 0 && (
              <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                <p className="mb-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Últimos cambios registrados
                </p>
                <div className="space-y-2">
                  {activeVer.recent_commits.slice(0, 5).map((c, idx) => (
                    <div
                      key={`${c.sha || idx}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="text-slate-800 dark:text-slate-200">{c.message || 'Actualización'}</span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {c.short_sha || c.sha?.slice(0, 7) || ''} {c.date ? `· ${c.date}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowTechUpdate((v) => !v)}
              className="mt-4 inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {showTechUpdate ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>Ver detalles técnicos</span>
            </button>

            {showTechUpdate && (
              <div className="mt-3 space-y-3 border-t border-slate-100 pt-3 text-xs font-mono text-slate-600 dark:border-slate-800 dark:text-slate-300">
                <div>
                  Versión interna: {activeVer?.current_version || activeVer?.version || (typeof window !== 'undefined' ? window.__INITIAL_APP_VERSION__ : undefined) || '12.7.1'} · Commit local:{' '}
                  {activeVer?.local_commit || activeVer?.local_hash || 'local'} · Remoto:{' '}
                  {activeVer?.remote_commit || activeVer?.remote_hash || '--'}
                </div>
                {updateOutput && (
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[11px] dark:bg-slate-800/60">
                    {updateOutput}
                  </pre>
                )}
                {sysLogs.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl bg-slate-50 p-3 text-[11px] dark:bg-slate-800/60">
                    <p className="mb-1 font-semibold">Registro de avisos del sistema:</p>
                    {sysLogs.slice(0, 12).map((log, idx) => (
                      <div key={idx} className="truncate">
                        [{log.timestamp || log.time_str || '--'}] {log.unit || log.source || log.category}: {log.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Native apps download (shown in Web browser only) */}
          {!isNativeApp && (
            <section className="cockpit-bento p-5">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Aplicaciones nativas para tus dispositivos
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Se verifican automáticamente al conectar por Wi-Fi local y funcionan cifradas desde fuera de casa usando el DNS detectado.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href="/download/recursos-cockpit.deb"
                  className="cockpit-subtile flex min-h-[60px] items-center justify-between px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:border-sky-400 dark:text-slate-100"
                >
                  <span className="flex items-center gap-3">
                    <span className="cockpit-pill-cyan inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Laptop className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block">App para ordenador Ubuntu (.deb)</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">Conecta, instala nodo o configura</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                </a>
                <a
                  href="/download/recursos-cockpit.apk"
                  className="cockpit-subtile flex min-h-[60px] items-center justify-between px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:border-emerald-400 dark:text-slate-100"
                >
                  <span className="flex items-center gap-3">
                    <span className="cockpit-pill-emerald inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                      <Smartphone className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block">App para móvil Android (.apk)</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">Conexión directa automática</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                </a>
              </div>
            </section>
          )}
        </div>
      )}

      {/* 2. Dispositivos conectados (Zero-Trust pairing) */}
      {subTab === 'devices' && (
        <section className="cockpit-bento p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200/70 dark:border-slate-800">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Dispositivos con permiso de acceso
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Equipos verificados por red local Wi-Fi o mediante clave maestra segura
              </p>
            </div>
            {devices.length > 1 && (
              <button
                type="button"
                onClick={handleRevokeAllOthers}
                className="cockpit-btn-off min-h-[40px] rounded-xl px-3.5 text-xs font-semibold transition-colors"
              >
                Desconectar los demás
              </button>
            )}
          </div>

          {devices.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No hay sesiones guardadas en este momento.
            </p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {devices.map((dev) => {
                const isOpen = expandedDevId === dev.id;
                const accessText = dev.full_access ? 'Aplicación nativa verificada' : 'Navegador web verificado';
                return (
                  <div key={dev.id} className="cockpit-subtile p-3.5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        {editingId === dev.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={aliasDraft}
                              onChange={(e) => setAliasDraft(e.target.value)}
                              className="cockpit-subtile min-h-[38px] px-3 text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveAlias(dev.id)}
                              className="cockpit-btn-accent inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 text-xs font-semibold"
                            >
                              <Check className="h-3.5 w-3.5" />
                              <span>Guardar</span>
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {dev.name} {dev.is_current ? '(Este dispositivo)' : ''}
                            </p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                dev.full_access ? 'cockpit-pill-violet' : 'cockpit-pill-cyan'
                              }`}
                            >
                              {accessText}
                            </span>
                          </div>
                        )}
                        <p className="mt-0.5 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {dev.connection_mode || 'LAN'} · {dev.local_ip || dev.last_external_ip || 'Conectado'} · Última visita:{' '}
                          {dev.last_seen || '--'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(dev.id);
                            setAliasDraft(dev.custom_alias || dev.name);
                          }}
                          className="min-h-[38px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          Renombrar
                        </button>
                        {!dev.is_current && (
                          <button
                            type="button"
                            onClick={() => handleRevokeDevice(dev.id)}
                            className="cockpit-btn-off inline-flex min-h-[38px] items-center gap-1 rounded-xl px-3 text-xs font-semibold transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Desconectar</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedDevId(isOpen ? null : dev.id)}
                          className="inline-flex min-h-[38px] items-center gap-1 px-2 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          <span>Ver detalles técnicos</span>
                          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200/70 bg-white p-3 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                        {JSON.stringify(
                          {
                            id: dev.id,
                            certificado: dev.certificate_serial,
                            hardware: dev.device_telemetry,
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 3. Manual Interactivo */}
      {subTab === 'manual' && (
        <section className="cockpit-bento space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Manual web interactivo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Diagrama de arquitectura, simuladores de telemetría y seguridad Zero-Trust e inspector de API en vivo
              </p>
            </div>
            <a
              href="/manual"
              target="_blank"
              rel="noopener noreferrer"
              className="cockpit-btn-accent inline-flex min-h-[40px] items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-all"
            >
              <span>Abrir en pantalla completa</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
          <div className="overflow-hidden rounded-[14px] border border-slate-200 dark:border-slate-800">
            <iframe
              ref={manualIframeRef}
              src="/manual"
              title="Manual Interactivo de Recursos"
              onLoad={() => {
                try {
                  manualIframeRef.current?.contentWindow?.postMessage({ type: 'RECURSOS_THEME', theme }, '*');
                } catch {
                  // ignore
                }
              }}
              className="h-[74vh] w-full bg-white dark:bg-[#020617]"
            />
          </div>
        </section>
      )}

      {/* 4. Pantalla móvil USB (Solo en Ubuntu nativa; en web/Android mensaje pasivo) */}
      {subTab === 'dex' && (
        <section className="cockpit-bento p-5">
          {!isUbuntuNative ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                Esperando dispositivo para conectarse en su versión nativa
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200/70 dark:border-slate-800">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                      Pantalla del móvil por USB (Modo Escritorio)
                    </h2>
                    <span className="cockpit-pill-emerald rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                      Puente nativo USB
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Proyecta y controla tu móvil Android conectado al ordenador por cable USB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDex}
                  className="cockpit-subtile inline-flex min-h-[40px] items-center gap-1.5 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Buscar cable USB</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
                <label className="block">
                  <span className="text-slate-500 dark:text-slate-400">Resolución</span>
                  <select
                    value={dexResolution}
                    onChange={(e) => setDexResolution(e.target.value)}
                    className="cockpit-subtile mt-1 min-h-[42px] w-full px-3"
                  >
                    <option value="1920x1080">Full HD (1920×1080)</option>
                    <option value="2560x1440">2K QHD (2560×1440)</option>
                    <option value="1280x720">HD (1280×720)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-slate-500 dark:text-slate-400">Fluidez</span>
                  <select
                    value={dexFps}
                    onChange={(e) => setDexFps(Number(e.target.value))}
                    className="cockpit-subtile mt-1 min-h-[42px] w-full px-3"
                  >
                    <option value={60}>60 imágenes/seg</option>
                    <option value={30}>30 imágenes/seg</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dexFullscreen}
                    onChange={(e) => setDexFullscreen(e.target.checked)}
                    className="h-4 w-4 rounded accent-sky-600"
                  />
                  <span className="text-slate-700 dark:text-slate-300">Abrir a pantalla completa</span>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                {dexStatus?.session_running ? (
                  <button
                    type="button"
                    onClick={() => handleDexAction(false)}
                    className="min-h-[44px] rounded-xl bg-rose-600 px-5 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Detener proyección
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDexAction(true, dexStatus?.devices?.[0]?.serial)}
                    className="cockpit-btn-accent min-h-[44px] rounded-xl px-5 text-xs font-semibold transition-all"
                  >
                    Iniciar proyección USB
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
      </ViewStage>
    </div>
  );
};
