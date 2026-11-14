import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Download,
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

type MoreSubTab = 'updates' | 'devices' | 'dex';

interface MoreViewProps {
  metrics: MetricsPayload | null;
  theme: ThemeMode;
  onChangeTheme: (next: ThemeMode) => void;
  initialSubTab?: string;
  onRefreshMetrics: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const MoreView: React.FC<MoreViewProps> = ({
  metrics,
  theme,
  onChangeTheme,
  initialSubTab,
  onRefreshMetrics,
  onNotify,
}) => {
  const { isUbuntuNative, isNativeApp } = detectNativeEnvironment();
  const [subTab, setSubTab] = useState<MoreSubTab>(() => {
    if (initialSubTab === 'devices' || initialSubTab === 'dex' || initialSubTab === 'updates') {
      return initialSubTab;
    }
    return 'updates';
  });

  // Updates state
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(metrics?.version_info ?? null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateOutput, setUpdateOutput] = useState('');
  const [showTechUpdate, setShowTechUpdate] = useState(false);
  const [sysLogs, setSysLogs] = useState<SystemErrorLogEntry[]>([]);

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
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 no-scrollbar dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setSubTab('updates')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            subTab === 'updates'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <GitCommit className="h-4 w-4" />
          <span>Actualizaciones y aspecto</span>
        </button>
        <button
          type="button"
          onClick={() => setSubTab('devices')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            subTab === 'devices'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>Dispositivos conectados</span>
        </button>
        {isUbuntuNative && (
          <button
            type="button"
            onClick={() => setSubTab('dex')}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'dex'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <Usb className="h-4 w-4" />
            <span>Pantalla móvil USB</span>
          </button>
        )}
      </div>

      {/* 1. Actualizaciones y aspecto (Selector de Tema Claro/Oscuro integrado aquí) */}
      {subTab === 'updates' && (
        <div className="space-y-4">
          {/* Theme Switcher inside GitHub Updater Panel */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Aspecto visual del panel
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Cambia al instante entre el diseño claro minimalista y el modo oscuro en web y apps
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 shrink-0">
                <button
                  type="button"
                  onClick={() => onChangeTheme('light')}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                    theme === 'light'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Sun className="h-4 w-4" />
                  <span>Claro</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTheme('dark')}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 text-xs font-semibold transition-colors ${
                    theme === 'dark'
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Moon className="h-4 w-4" />
                  <span>Oscuro</span>
                </button>
              </div>
            </div>
          </section>

          {/* GitHub Auto-Updater */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    Actualizaciones desde GitHub
                  </h2>
                  <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400">
                    v{displayVer}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.update_available
                    ? `Hay una versión nueva disponible (v${remoteDisplayVer}).`
                    : activeVer?.ahead_of_remote
                      ? 'Tienes cambios locales más recientes que el repositorio.'
                      : 'Tu sistema está al día con la última versión.'}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {activeVer?.auto_install_status || 'Actualización automática activada'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleAutoUpdate}
                  className={`min-h-[44px] rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors ${
                    activeVer?.auto_install_enabled
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {activeVer?.auto_install_enabled ? 'Autoactualización activada' : 'Autoactualización pausada'}
                </button>
                <button
                  type="button"
                  disabled={checkingUpdate}
                  onClick={() => loadVersion(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                  <span>Comprobar</span>
                </button>
                <button
                  type="button"
                  disabled={installingUpdate}
                  onClick={handleApplyUpdate}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-white dark:text-slate-900"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{installingUpdate ? 'Actualizando...' : 'Actualizar ahora'}</span>
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
                  Versión interna: {activeVer?.current_version || activeVer?.version || '12.0.0'} · Commit local:{' '}
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
            <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Aplicaciones nativas para tus dispositivos
              </h2>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Se verifican automáticamente al conectar por Wi-Fi local y funcionan cifradas desde fuera de casa usando el DNS detectado.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <a
                  href="/download/recursos-cockpit.deb"
                  className="flex min-h-[56px] items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-3">
                    <Laptop className="h-5 w-5 text-blue-600" />
                    <span>
                      <span className="block">App para ordenador Ubuntu (.deb)</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">Conecta, instala nodo o configura</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-slate-400" />
                </a>
                <a
                  href="/download/recursos-cockpit.apk"
                  className="flex min-h-[56px] items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-3">
                    <Smartphone className="h-5 w-5 text-emerald-600" />
                    <span>
                      <span className="block">App para móvil Android (.apk)</span>
                      <span className="font-normal text-slate-500 dark:text-slate-400">Conexión directa automática</span>
                    </span>
                  </span>
                  <Download className="h-4 w-4 text-slate-400" />
                </a>
              </div>
            </section>
          )}
        </div>
      )}

      {/* 2. Dispositivos conectados (Zero-Trust pairing) */}
      {subTab === 'devices' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
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
                className="min-h-[40px] rounded-xl border border-rose-200 bg-rose-50 px-3.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
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
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {devices.map((dev) => {
                const isOpen = expandedDevId === dev.id;
                const accessText = dev.full_access ? 'Aplicación nativa verificada' : 'Navegador web verificado';
                return (
                  <div key={dev.id} className="py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        {editingId === dev.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={aliasDraft}
                              onChange={(e) => setAliasDraft(e.target.value)}
                              className="min-h-[38px] rounded-xl border border-slate-300 px-3 text-xs dark:border-slate-700 dark:bg-slate-800"
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveAlias(dev.id)}
                              className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
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
                            <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">{accessText}</span>
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
                          className="min-h-[38px] rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                        >
                          Renombrar
                        </button>
                        {!dev.is_current && (
                          <button
                            type="button"
                            onClick={() => handleRevokeDevice(dev.id)}
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300"
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
                      <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-50 p-3 font-mono text-[11px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
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

      {/* 3. Pantalla móvil USB (Solo en Ubuntu nativa; en web/Android mensaje pasivo) */}
      {subTab === 'dex' && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {!isUbuntuNative ? (
            <div className="flex flex-col items-center py-10 text-center">
              <Lock className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                Esperando dispositivo para conectarse en su versión nativa
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Pantalla del móvil por USB (Modo Escritorio)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Proyecta y controla tu móvil Android conectado al ordenador por cable USB
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadDex}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"
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
                    className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800"
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
                    className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 dark:border-slate-700 dark:bg-slate-800"
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
                    className="h-4 w-4 rounded"
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
                    className="min-h-[44px] rounded-xl bg-slate-900 px-5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                  >
                    Iniciar proyección USB
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
