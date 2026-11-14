export type MainTabId = 'inicio' | 'equipo' | 'red' | 'programas' | 'mas';
export type ThemeMode = 'light' | 'dark';

export interface SystemInfo {
  hostname?: string;
  os?: string;
  os_id?: string;
  os_domain?: string;
  os_logo_url?: string;
  kernel?: string;
  uptime_seconds?: number;
  uptime_str?: string;
  public_domain?: string;
  local_ip?: string;
  timestamp?: number;
  time_str?: string;
}

export interface CpuInfo {
  model?: string;
  architecture?: string;
  vendor?: string;
  cache_size?: string;
  logical_cores?: number;
  physical_cores?: number;
  usage_percent?: number;
  per_core_percent?: number[];
  freq_mhz?: number;
  freq_max_mhz?: number;
  freq_min_mhz?: number;
  temp_c?: number | null;
  load_1m?: number;
  load_5m?: number;
  load_15m?: number;
  error?: string;
}

export interface GpuProcessInfo {
  pid?: string;
  name?: string;
  raw_name?: string;
  full_path?: string;
  used_memory?: string;
  type?: string;
}

export interface GpuInfo {
  available?: boolean;
  name?: string;
  driver?: string;
  cuda?: string;
  temp_c?: number | null;
  gpu_util_percent?: number;
  mem_util_percent?: number;
  vram_total_mb?: number;
  vram_used_mb?: number;
  vram_free_mb?: number;
  vram_percent?: number;
  fan_percent?: number | null;
  power_watts?: number | null;
  processes?: GpuProcessInfo[];
  error?: string;
}

export interface RamInfo {
  total_bytes?: number;
  used_bytes?: number;
  free_bytes?: number;
  available_bytes?: number;
  cached_bytes?: number;
  buffers_bytes?: number;
  cached_total_bytes?: number;
  total_used_bytes?: number;
  percent?: number;
  cached_percent?: number;
  total_used_percent?: number;
  available_percent?: number;
  free_percent?: number;
  swap_total_bytes?: number;
  swap_used_bytes?: number;
  swap_free_bytes?: number;
  swap_percent?: number;
  zram_active?: boolean;
  zram_total_bytes?: number;
  zram_used_bytes?: number;
  disk_swap_total_bytes?: number;
  disk_swap_used_bytes?: number;
}

export interface DiskInfo {
  mountpoint: string;
  label?: string;
  device?: string;
  fstype?: string;
  temp_c?: number | null;
  total_bytes?: number;
  used_bytes?: number;
  free_bytes?: number;
  percent?: number;
}

export interface DiskIoInfo {
  read_bytes_sec?: number;
  write_bytes_sec?: number;
  read_total_bytes?: number;
  write_total_bytes?: number;
}

export interface NicHistoryBucket {
  t: number;
  rx: number;
  tx: number;
}

export interface NetInterfaceInfo {
  name: string;
  ip?: string;
  ipv6?: string;
  mac?: string;
  is_up?: boolean;
  speed_mbps?: number;
  mtu?: number;
  bytes_sent?: number;
  bytes_recv?: number;
  rx_bytes_sec?: number;
  tx_bytes_sec?: number;
  history_2h?: NicHistoryBucket[];
}

export interface GeoConnectionItem {
  ip?: string;
  remote_ip?: string;
  local_ip?: string;
  port?: number;
  remote_port?: number;
  local_port?: number;
  service?: string;
  process?: string;
  lat?: number;
  lng?: number;
  city?: string;
  region?: string;
  country?: string;
  country_code?: string;
  isp?: string;
  org?: string;
  asn?: string;
  rx_bytes?: number;
  tx_bytes?: number;
  direction?: string;
  is_server_node?: boolean;
  status?: string;
}

export interface ConnectionsMapPayload {
  connections?: GeoConnectionItem[];
  server_node?: GeoConnectionItem;
  geoip_worker?: {
    resolved_count?: number;
    pending_count?: number;
    cache_hits?: number;
    cache_misses?: number;
    errors_count?: number;
    last_error?: string;
    errors?: Array<{
      timestamp?: string;
      phase?: string;
      target?: string;
      code?: string;
      message?: string;
    }>;
  };
}

export interface NetInfo {
  rx_bytes_sec?: number;
  tx_bytes_sec?: number;
  rx_total_bytes?: number;
  tx_total_bytes?: number;
  local_ip?: string;
  interfaces?: Record<string, NetInterfaceInfo>;
  interfaces_list?: NetInterfaceInfo[];
  connections_map?: ConnectionsMapPayload;
}

export interface WifiClient {
  ip?: string;
  mac?: string;
  name?: string;
  hostname?: string;
  vendor?: string;
  brand?: string;
  device_type?: string;
  interface?: string;
  band?: string;
  rssi?: number | string;
  tx_rate?: string;
  rx_rate?: string;
  online?: boolean;
  is_online?: boolean;
  is_server?: boolean;
  is_gateway?: boolean;
  logo_url?: string;
  custom_logo_key?: string;
  last_seen?: string;
  uptime?: string;
}

export interface WifiSummary {
  total_clients?: number;
  online_clients?: number;
  offline_clients?: number;
  router_model?: string;
  router_ip?: string;
  router_online?: boolean;
  band_24g?: number;
  band_5g?: number;
  wired_clients?: number;
}

export interface SystemProcess {
  pid: number;
  name: string;
  user?: string;
  cpu_percent?: number;
  mem_mb?: number;
  priv_mb?: number;
  shared_mb?: number;
  mem_percent?: number;
  vram_mb?: number;
  gpu_type?: string;
  nice?: number;
  status?: string;
}

export interface DockerActivity {
  id: string;
  name: string;
  image?: string;
  state?: string;
  status?: string;
  cpu_percent?: number | string;
  cpu_val?: number;
  cpu_norm_percent?: number;
  mem_percent?: number | string;
  mem_pct_val?: number;
  mem_mb?: number;
  mem_usage?: string;
  net_io?: string;
  block_io?: string;
  pids?: string;
  vram_mb?: number;
  logo_url?: string;
}

export interface SystemdService {
  name: string;
  unit?: string;
  role?: string;
  description?: string;
  active?: boolean;
  state?: string;
  active_state?: string;
  sub_state?: string;
  pid?: number;
  memory_mb?: number;
}

export interface TorrentItem {
  hash: string;
  name: string;
  size?: number;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  state?: string;
  eta?: number;
  num_seeds?: number;
  num_leechs?: number;
}

export interface TorrentStats {
  dl_info_speed?: number;
  up_info_speed?: number;
  dl_info_data?: number;
  up_info_data?: number;
  connection_status?: string;
}

export interface EmbySession {
  user?: string;
  client?: string;
  device?: string;
  item_name?: string;
  series_name?: string;
  media_type?: string;
  play_method?: string;
  is_paused?: boolean;
  progress_percent?: number;
}

export interface EmbyRecentItem {
  name: string;
  series?: string;
  type?: string;
}

export interface EmbyData {
  online?: boolean;
  available?: boolean;
  server_name?: string;
  version?: string;
  active_streams?: number;
  sessions?: EmbySession[];
  library_counts?: Record<string, number>;
  movies_count?: number;
  series_count?: number;
  episodes_count?: number;
  recent_media?: EmbyRecentItem[];
}

export interface Fail2banBanItem {
  ip: string;
  jail?: string;
  banned_at?: number;
  banned_at_str?: string;
  is_active?: boolean;
  country?: string;
  city?: string;
}

export interface SecurityData {
  fail2ban?: {
    active?: boolean;
    available?: boolean;
    jails?: string[];
    banned_ips?: string[];
    banned_details?: Fail2banBanItem[];
    all_time_banned?: Fail2banBanItem[];
    total_banned?: number;
  };
  pihole?: {
    online?: boolean;
    available?: boolean;
    total_queries?: number;
    dns_queries_today?: number;
    blocked_today?: number;
    ads_blocked_today?: number;
    percent_blocked?: number;
    ads_percentage_today?: number;
    domains_blocked?: number;
    domains_being_blocked?: number;
  };
}

export interface HistorySeries {
  timestamps?: string[];
  cpu?: number[];
  gpu?: number[];
  ram?: number[];
  ram_total?: number[];
  net_rx?: number[];
  net_tx?: number[];
  disk_r?: number[];
  disk_w?: number[];
  disk_pct?: number[];
}

export interface RecentCommitItem {
  sha?: string;
  short_sha?: string;
  message?: string;
  author?: string;
  date?: string;
}

export interface VersionInfo {
  current_version: string;
  version?: string;
  display_version?: string;
  remote_version?: string;
  remote_display_version?: string;
  local_commit?: string;
  local_hash?: string;
  remote_commit?: string;
  remote_hash?: string;
  update_available?: boolean;
  ahead_of_remote?: boolean;
  has_git?: boolean;
  commits_behind?: number;
  recent_commits?: RecentCommitItem[];
  auto_install_enabled?: boolean;
  auto_install_status?: string;
  last_checked?: string;
  public_domain?: string;
  local_ip?: string;
  repo_url?: string;
  error?: string;
}

export interface AuthStatus {
  is_local?: boolean;
  is_trusted?: boolean;
  client_ip?: string;
  public_domain?: string;
  local_ip?: string;
  token?: string;
  device_name?: string;
}

export interface TrustedClientEntry {
  client_key?: string;
  client_type?: string;
  client_label?: string;
  full_access?: boolean;
  last_seen?: string;
  is_current_client?: boolean;
}

export interface TrustedDevice {
  id: string;
  name: string;
  auto_name?: string;
  custom_alias?: string;
  client_type?: string;
  client_label?: string;
  clients?: TrustedClientEntry[];
  clients_count?: number;
  access_level?: string;
  full_access?: boolean;
  app_version?: string;
  hardware_id?: string;
  certificate_serial?: string;
  first_seen?: string;
  last_seen?: string;
  local_ip?: string;
  last_external_ip?: string;
  connection_mode?: string;
  verified_in_lan?: boolean;
  trusted?: boolean;
  is_current?: boolean;
  device_telemetry?: Record<string, unknown>;
}

export interface SystemErrorLogEntry {
  timestamp?: string;
  time_str?: string;
  unit?: string;
  source?: string;
  category?: string;
  level?: string;
  message?: string;
}

export interface SystemErrorsSummary {
  total?: number;
  total_errors?: number;
  failed_units_count?: number;
  counts_by_category?: Record<string, number>;
}

export interface DexStatusPayload {
  success?: boolean;
  detected_env?: string;
  is_native_or_mobile?: boolean;
  usb_listening?: boolean;
  session_running?: boolean;
  devices?: Array<{
    serial: string;
    model?: string;
    manufacturer?: string;
    state?: string;
    android_version?: string;
  }>;
  dependencies?: {
    adb?: boolean;
    scrcpy?: boolean;
    ready?: boolean;
  };
}

export interface TelegramBotStatusPayload {
  success?: boolean;
  bot_status?: {
    online?: boolean;
    username?: string;
    first_name?: string;
    polling_active?: boolean;
    last_poll?: string;
    messages_sent?: number;
  };
  allowed_users?: number[];
  config?: {
    notify_completed_torrents?: boolean;
    notify_network_changes?: boolean;
  };
  activity?: Array<{
    timestamp?: string;
    direction?: string;
    title?: string;
    content?: string;
    user_name?: string;
    status?: string;
  }>;
}

export interface MetricsPayload {
  system?: SystemInfo;
  cpu?: CpuInfo;
  gpu?: GpuInfo;
  ram?: RamInfo;
  disks?: DiskInfo[];
  disk_io?: DiskIoInfo;
  net?: NetInfo;
  docker_activities?: DockerActivity[];
  systemd_services?: SystemdService[];
  torrents?: TorrentItem[];
  torrent_stats?: TorrentStats;
  emby?: EmbyData;
  system_processes?: SystemProcess[];
  wifi_clients?: WifiClient[];
  wifi_summary?: WifiSummary;
  security?: SecurityData;
  history?: HistorySeries;
  telegram_bot?: Record<string, unknown>;
  system_errors_summary?: SystemErrorsSummary;
  auth_status?: AuthStatus;
  version_info?: VersionInfo;
  custom_logos?: Record<string, string>;
  maps_engine?: string;
}

declare global {
  interface Window {
    __INITIAL_APP_VERSION__?: string;
    __INITIAL_DISPLAY_VERSION__?: string;
    __INITIAL_APP_HASH__?: string;
    __RECURSOS_UBUNTU_NATIVE__?: boolean;
    __RECURSOS_ANDROID_NATIVE__?: boolean;
    __RECURSOS_DEVICE_TELEMETRY__?: Record<string, unknown>;
    AndroidBridge?: {
      getAppVersion?: () => string;
      reconnect?: () => void;
    };
    webkit?: {
      messageHandlers?: {
        recursosNative?: {
          postMessage: (msg: unknown) => void;
        };
      };
    };
    switchView?: (viewName: string) => void;
    injectNativeSession?: (token: string, telemetry?: Record<string, unknown>) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    d3?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    L?: any;
  }
}
