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

export interface CpuTempSensor {
  label: string;
  temp_c: number;
}

export interface CpuThermalProbesHistory {
  timestamps: string[];
  epoch_ts: number[];
  probes: Record<string, number[]>;
}

export interface CpuCapabilities {
  usage?: boolean;
  temp?: boolean;
  freq?: boolean;
  power?: boolean;
  times?: boolean;
  load?: boolean;
  cores?: boolean;
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
  governor?: string | null;
  temp_c?: number | null;
  temp_sensors?: CpuTempSensor[];
  temp_sensors_history?: CpuThermalProbesHistory;
  power_watts?: number | null;
  user_percent?: number;
  system_percent?: number;
  iowait_percent?: number;
  idle_percent?: number;
  load_1m?: number;
  load_5m?: number;
  load_15m?: number;
  capabilities?: CpuCapabilities;
  error?: string;
}

export interface GpuProcessInfo {
  pid?: string;
  name?: string;
  name_key?: string | null;
  raw_name?: string;
  full_path?: string;
  used_memory?: string;
  vram_mb?: number;
  vram_percent?: number;
  gpu_util_percent?: number | null;
  gpu_mem_percent?: number | null;
  gpu_enc_percent?: number | null;
  gpu_dec_percent?: number | null;
  type?: string;
}

export interface GpuCapabilities {
  compute?: boolean;
  vram?: boolean;
  mem_ctrl?: boolean;
  encoder?: boolean;
  decoder?: boolean;
  jpeg?: boolean;
  ofa?: boolean;
  power?: boolean;
  temp?: boolean;
  mem_temp?: boolean;
  clocks?: boolean;
  pcie?: boolean;
  fan?: boolean;
}

export interface GpuHistorySample {
  t: number;
  util?: number | null;
  mem_util?: number | null;
  vram_pct?: number | null;
  vram_mb?: number | null;
  enc?: number | null;
  dec?: number | null;
  temp?: number | null;
  power?: number | null;
  clock_gfx?: number | null;
  clock_mem?: number | null;
  pcie_rx?: number | null;
  pcie_tx?: number | null;
}

export interface GpuInfo {
  available?: boolean;
  name?: string;
  driver?: string;
  cuda?: string;
  temp_c?: number | null;
  mem_temp_c?: number | null;
  gpu_util_percent?: number;
  mem_util_percent?: number | null;
  encoder_util_percent?: number | null;
  decoder_util_percent?: number | null;
  jpeg_util_percent?: number | null;
  ofa_util_percent?: number | null;
  encoder_sessions?: number | null;
  encoder_fps?: number | null;
  vram_total_mb?: number;
  vram_used_mb?: number;
  vram_free_mb?: number;
  vram_percent?: number;
  bar1_used_mb?: number | null;
  bar1_total_mb?: number | null;
  fan_percent?: number | null;
  power_watts?: number | null;
  power_limit_watts?: number | null;
  clock_graphics_mhz?: number | null;
  clock_max_graphics_mhz?: number | null;
  clock_mem_mhz?: number | null;
  clock_max_mem_mhz?: number | null;
  clock_video_mhz?: number | null;
  pcie_tx_kbps?: number | null;
  pcie_rx_kbps?: number | null;
  pcie_gen?: number | null;
  pcie_width?: number | null;
  capabilities?: GpuCapabilities;
  history?: GpuHistorySample[];
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

export interface DiskIoSample {
  t: number;
  r: number;
  w: number;
  temp?: number | null;
}

export interface DiskInfo {
  mountpoint: string;
  label?: string;
  label_key?: string;
  label_params?: Record<string, string>;
  device?: string;
  fstype?: string;
  fstype_key?: string;
  kind?: 'local' | 'removable' | 'network';
  transport?: string;
  transport_key?: string;
  model?: string | null;
  mounted?: boolean;
  is_removable?: boolean;
  pool_key?: string;
  pool_primary?: boolean;
  pool_shared_with?: string | null;
  shared_mounts?: string[];
  shared_labels?: string[];
  io_device?: string;
  read_bytes_sec?: number;
  write_bytes_sec?: number;
  io_history?: DiskIoSample[];
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
  wan_rx?: number;
  wan_tx?: number;
  lan_rx?: number;
  lan_tx?: number;
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
  wan_rx_bytes_sec?: number;
  wan_tx_bytes_sec?: number;
  lan_rx_bytes_sec?: number;
  lan_tx_bytes_sec?: number;
  history_2h?: NicHistoryBucket[];
}

export interface GeoConnectionItem {
  id?: string;
  ip?: string;
  public_ip?: string;
  remote_ip?: string;
  local_ip?: string;
  local_hostname?: string;
  port?: number;
  remote_port?: number;
  local_port?: number;
  protocol?: string;
  domain?: string;
  service?: string;
  process?: string;
  jail?: string;
  details?: string;
  state?: string;
  lat?: number;
  lng?: number;
  city?: string;
  raw_city?: string;
  city_key?: string;
  region?: string;
  postal?: string;
  country?: string;
  country_code?: string;
  isp?: string;
  org?: string;
  asn?: string;
  rx_bytes?: number;
  tx_bytes?: number;
  bytes_sent?: number;
  bytes_received?: number;
  bytes_total?: number;
  tx_speed?: number;
  rx_speed?: number;
  total_speed?: number;
  direction?: 'incoming' | 'outgoing' | 'blocked' | string;
  is_lan?: boolean;
  is_server_node?: boolean;
  status?: string;
  hit_count?: number;
  first_seen?: number;
  last_seen?: number;
  is_history?: boolean;
  accuracy_source?: string;
  geo_status?: string;
}

export interface AiConnectionInsight {
  signature: string;
  app_name: string;
  category: string;
  summary: string;
  role: string;
  confidence: 'high' | 'medium' | 'low' | string;
  model?: string;
  provider?: string;
  analyzed_at?: number;
  updated_at?: number;
}

export interface AiIdentifyResponse {
  ok: boolean;
  model?: string;
  insights?: Record<string, AiConnectionInsight>;
  error?: string;
  code?: string;
}

export interface ConnectionsMapSummary {
  total?: number;
  incoming?: number;
  outgoing?: number;
  blocked?: number;
  devices?: number;
}

export interface ConnectionsMapPayload {
  connections?: GeoConnectionItem[];
  server_node?: GeoConnectionItem;
  summary?: ConnectionsMapSummary;
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

export interface PingTargetSeries {
  id: string;
  ip: string;
  label: string;
  kind: 'gateway' | 'external' | 'dns' | string;
  avg_ms: number | null;
  last_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  jitter_ms: number;
  loss_pct: number;
  color: string;
  data: number[];
}

export interface PingLatencyPayload {
  updated_at?: string;
  timestamps: string[];
  epoch_ts: number[];
  targets: PingTargetSeries[];
}

export interface PingHistoryResponse {
  ok: boolean;
  error?: string;
  db_file?: string;
  oldest_ts: number | null;
  newest_ts: number | null;
  window_start_ts: number | null;
  window_end_ts: number | null;
  total_samples: number;
  returned_samples: number;
  has_older: boolean;
  has_newer: boolean;
  series: {
    timestamps: string[];
    date_timestamps: string[];
    epoch_ts: number[];
    targets: PingTargetSeries[];
  };
}

export type ProcessHistoryMetric = 'cpu' | 'ram' | 'vram' | 'io';

export interface ProcessHistorySeriesItem {
  id: string;
  label: string;
  is_others?: boolean;
  color: string;
  avg: number;
  peak: number;
  last: number;
  data: number[];
}

export interface ProcessHistoryResponse {
  ok: boolean;
  error?: string;
  metric: ProcessHistoryMetric;
  unit: string;
  hours: number;
  bucket_count: number;
  total_snapshots: number;
  oldest_ts: number | null;
  newest_ts: number | null;
  timestamps: string[];
  date_timestamps: string[];
  epoch_ts: number[];
  series: ProcessHistorySeriesItem[];
}

export interface SpeedTestResult {
  id: number;
  ts: number;
  created_at: string;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  server_name: string;
  server_host: string;
  server_location: string;
  client_ip: string;
  isp: string;
  duration_ms: number;
  scope: 'wan' | 'local_node' | string;
}

export interface SpeedTestStatus {
  ok?: boolean;
  running: boolean;
  phase: 'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error' | string;
  progress_pct: number;
  current_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  download_mbps: number;
  upload_mbps: number;
  server_name: string;
  server_host: string;
  server_location: string;
  client_ip: string;
  isp: string;
  scope: 'wan' | 'local_node' | string;
  error?: string;
  started_at?: number | null;
  completed_at?: number | null;
  last_result?: SpeedTestResult | null;
}

export interface SpeedTestHistoryResponse {
  ok: boolean;
  db_file?: string;
  total: number;
  best_download_mbps: number;
  best_upload_mbps: number;
  avg_ping_ms: number;
  items: SpeedTestResult[];
}

export interface NetHistoryServiceCatalogItem {
  service: string;
  connections_count?: number;
  total_hits?: number;
  hit_count?: number;
  unique_ips?: number;
  unique_devices?: number;
  device_count?: number;
  countries?: string[];
  sample_domains?: string[];
  first_seen?: number;
  last_seen?: number | string;
}

export interface NetHistoryCountryCatalogItem {
  country: string;
  country_code?: string;
  connections_count?: number;
  total_hits?: number;
  unique_ips?: number;
  cities_count?: number;
  unique_devices?: number;
  last_seen?: number;
}

export interface NetHistoryDomainCatalogItem {
  domain: string;
  connections_count?: number;
  total_hits?: number;
  unique_ips?: number;
  unique_devices?: number;
  top_service?: string;
  top_country?: string;
  top_country_code?: string;
  last_seen?: number;
}

export interface NetHistoryDeviceCatalogItem {
  ip: string;
  name?: string;
  connections_count?: number;
  total_hits?: number;
  services_count?: number;
  last_seen?: number | string;
}

export interface NetHistoryResponse {
  status?: string;
  summary?: {
    total_records?: number;
    total_services?: number;
    total_unique_ips?: number;
    total_devices?: number;
    total_countries?: number;
    total_domains?: number;
    total_hits?: number;
  };
  services_catalog?: NetHistoryServiceCatalogItem[];
  countries_catalog?: NetHistoryCountryCatalogItem[];
  domains_catalog?: NetHistoryDomainCatalogItem[];
  devices_catalog?: NetHistoryDeviceCatalogItem[];
  connections?: GeoConnectionItem[];
  ai_insights?: Record<string, AiConnectionInsight>;
}

export interface DnsTopDomainItem {
  domain: string;
  count: number;
  blocked_count?: number;
  pct_blocked?: number;
  clients_count?: number;
  avg_reply_ms?: number;
}

export interface DnsTrafficClientItem {
  ip: string;
  name?: string;
  total: number;
  blocked: number;
  pct_blocked?: number;
  top_domains?: Array<{ domain: string; count: number }>;
}

export interface DnsTrafficRecentQuery {
  time?: string;
  timestamp?: number;
  client_ip?: string;
  client_name?: string;
  domain?: string;
  status?: number;
  is_blocked?: boolean;
  forward?: string;
  reply_ms?: number;
}

export interface DnsTrafficStatsResponse {
  available?: boolean;
  error?: string;
  summary?: {
    total_queries_24h?: number;
    blocked_queries_24h?: number;
    pct_blocked_24h?: number;
    unique_domains_24h?: number;
    unique_clients_24h?: number;
  };
  top_domains?: DnsTopDomainItem[];
  clients?: DnsTrafficClientItem[];
  recent_queries?: DnsTrafficRecentQuery[];
}

export interface NetInfo {
  rx_bytes_sec?: number;
  tx_bytes_sec?: number;
  wan_rx_bytes_sec?: number;
  wan_tx_bytes_sec?: number;
  lan_rx_bytes_sec?: number;
  lan_tx_bytes_sec?: number;
  rx_total_bytes?: number;
  tx_total_bytes?: number;
  local_ip?: string;
  interfaces?: Record<string, NetInterfaceInfo>;
  interfaces_list?: NetInterfaceInfo[];
  router_history_20m?: NicHistoryBucket[];
  ping_latency?: PingLatencyPayload;
  connections_map?: ConnectionsMapPayload;
}

export interface WifiClient {
  ip?: string;
  mac?: string;
  name?: string;
  hostname?: string;
  vendor?: string;
  vendor_key?: string;
  brand?: string;
  device_type?: string;
  dev_type?: string;
  dev_icon?: string;
  iface?: string;
  interface?: string;
  conn_type?: string;
  band?: string;
  band_key?: string;
  band_params?: Record<string, string | number>;
  rssi?: number | string;
  tx_rate?: string;
  rx_rate?: string;
  tx_bytes?: number;
  rx_bytes?: number;
  speed_down?: number;
  speed_up?: number;
  wan_speed_down?: number;
  wan_speed_up?: number;
  lan_speed_down?: number;
  lan_speed_up?: number;
  sources?: string[];
  pihole_queries?: number;
  first_seen_ts?: number;
  last_seen_ts?: number;
  asus_node?: string;
  in_network?: number;
  online?: boolean;
  is_online?: boolean;
  is_server?: boolean;
  is_gateway?: boolean;
  logo_url?: string;
  custom_logo_key?: string;
  last_seen?: string;
  uptime?: string;
}

export interface WifiSourceStatus {
  available?: boolean;
  count?: number;
  online_count?: number;
  label?: string;
  model?: string;
  ip?: string;
  creds_decrypt_failed?: boolean;
}

export interface WifiSummary {
  total_clients?: number;
  online_clients?: number;
  offline_clients?: number;
  router_model?: string;
  router_ip?: string;
  router_online?: boolean;
  router_configured?: boolean;
  router_ssh_error?: string;
  router_encrypted?: boolean;
  router_creds_decrypt_failed?: boolean;
  router_auth_mode?: string;
  asus_model?: string;
  gateway_ip?: string;
  gateway_mac?: string;
  gateway_name?: string;
  gateway_model?: string;
  pihole_db_total?: number;
  router_wan_available?: boolean;
  router_wan_rx_bytes_sec?: number;
  router_wan_tx_bytes_sec?: number;
  router_lan_rx_bytes_sec?: number;
  router_lan_tx_bytes_sec?: number;
  router_traffic_source?: string;
  router_history_20m?: NicHistoryBucket[];
  sources_status?: {
    pihole?: WifiSourceStatus;
    asus?: WifiSourceStatus;
    gateway?: WifiSourceStatus;
  };
  band_24g?: number;
  band_5g?: number;
  wired_clients?: number;
}

export interface NetworkDevicesDbResponse {
  ok?: boolean;
  updated_at?: string;
  summary?: WifiSummary;
  devices?: WifiClient[];
  total_count?: number;
}

export interface RouterCredentialsStatus {
  ok?: boolean;
  is_local?: boolean;
  can_configure?: boolean;
  configured?: boolean;
  router_ip?: string;
  router_port?: number;
  router_user?: string;
  encrypted?: boolean;
  decrypt_failed?: boolean;
  sshpass_available?: boolean;
  gateway_ip?: string;
  model?: string;
  message?: string;
  error?: string;
  lan_only?: boolean;
}

export interface SystemProcess {
  pid: number;
  name: string;
  user?: string;
  cpu_percent?: number;
  cpu_norm_percent?: number;
  cpu_cores_used?: number;
  num_threads?: number;
  mem_mb?: number;
  priv_mb?: number;
  shared_mb?: number;
  mem_percent?: number;
  io_read_bps?: number;
  io_write_bps?: number;
  io_total_bps?: number;
  io_percent?: number;
  io_read_total_bytes?: number;
  io_write_total_bytes?: number;
  net_connections?: number;
  net_established?: number;
  net_percent?: number;
  net_ports?: string;
  vram_mb?: number;
  vram_percent?: number;
  gpu_util_percent?: number | null;
  gpu_mem_percent?: number | null;
  gpu_enc_percent?: number | null;
  gpu_dec_percent?: number | null;
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
  role_key?: string;
  description?: string;
  active?: boolean;
  state?: string;
  state_key?: string;
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
  id?: number | string;
  name?: string;
  title?: string;
  series?: string;
  series_name?: string;
  season?: number | null;
  episode?: number | null;
  year?: number | null;
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

export type TelemetryMetricKey =
  | 'cpu'
  | 'cpu_temp'
  | 'cpu_freq'
  | 'cpu_power'
  | 'cpu_load_1m'
  | 'cpu_load_5m'
  | 'cpu_user'
  | 'cpu_system'
  | 'cpu_iowait'
  | 'gpu'
  | 'gpu_vram_pct'
  | 'gpu_mem_ctrl'
  | 'gpu_enc'
  | 'gpu_dec'
  | 'gpu_power'
  | 'gpu_temp'
  | 'gpu_clk_gfx'
  | 'gpu_clk_mem'
  | 'gpu_pcie_rx'
  | 'gpu_pcie_tx'
  | 'ram'
  | 'ram_total'
  | 'net_rx'
  | 'net_tx'
  | 'net_wan_rx'
  | 'net_wan_tx'
  | 'net_lan_rx'
  | 'net_lan_tx'
  | 'disk_r'
  | 'disk_w'
  | 'disk_pct'
  | 'disk_temp';

export interface HistorySeries {
  timestamps?: string[];
  date_timestamps?: string[];
  epoch_ts?: number[];
  cpu?: number[];
  cpu_temp?: number[];
  cpu_freq?: number[];
  cpu_power?: number[];
  cpu_load_1m?: number[];
  cpu_load_5m?: number[];
  cpu_user?: number[];
  cpu_system?: number[];
  cpu_iowait?: number[];
  gpu?: number[];
  gpu_vram_pct?: number[];
  gpu_mem_ctrl?: number[];
  gpu_enc?: number[];
  gpu_dec?: number[];
  gpu_power?: number[];
  gpu_temp?: number[];
  gpu_clk_gfx?: number[];
  gpu_clk_mem?: number[];
  gpu_pcie_rx?: number[];
  gpu_pcie_tx?: number[];
  ram?: number[];
  ram_total?: number[];
  net_rx?: number[];
  net_tx?: number[];
  net_wan_rx?: number[];
  net_wan_tx?: number[];
  net_lan_rx?: number[];
  net_lan_tx?: number[];
  disk_r?: number[];
  disk_w?: number[];
  disk_pct?: number[];
  disk_temp?: number[];
}

export interface TelemetryHistoryResponse {
  ok: boolean;
  db_file?: string;
  oldest_ts: number | null;
  newest_ts: number | null;
  window_start_ts: number | null;
  window_end_ts: number | null;
  total_samples: number;
  returned_samples: number;
  has_older: boolean;
  has_newer: boolean;
  series: HistorySeries;
}

export interface EntityHistoryResponse {
  ok: boolean;
  db_file?: string;
  entity_kind: 'disk' | 'nic' | 'cpu_sensor' | string;
  entity_id: string;
  oldest_ts: number | null;
  newest_ts: number | null;
  window_start_ts: number | null;
  window_end_ts: number | null;
  total_samples: number;
  returned_samples: number;
  has_older: boolean;
  has_newer: boolean;
  series: HistorySeries & {
    temp_c?: number[];
    probes?: Record<string, number[]>;
  };
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
  app_version?: string;
  app_display_version?: string;
  server_version?: string;
  server_display_version?: string;
  server_reachable?: boolean;
  github_version?: string;
  github_display_version?: string;
  remote_version?: string;
  remote_display_version?: string;
  local_commit?: string;
  local_hash?: string;
  remote_commit?: string;
  remote_hash?: string;
  update_available?: boolean;
  effective_update_available?: boolean;
  ahead_of_remote?: boolean;
  app_above_server?: boolean;
  app_above_github?: boolean;
  github_above_server?: boolean;
  github_above_app?: boolean;
  server_needs_update?: boolean;
  target_version?: string;
  update_mode?: string;
  update_action_label?: string;
  update_summary?: string;
  ubuntu_native_bridge?: boolean;
  has_git?: boolean;
  commits_behind?: number;
  recent_commits?: RecentCommitItem[];
  auto_install_enabled?: boolean;
  auto_install_in_progress?: boolean;
  auto_install_status?: string;
  last_auto_install?: string;
  last_checked?: string;
  public_domain?: string;
  local_ip?: string;
  repo_url?: string;
  error?: string;
}

export interface AuthStatus {
  is_local?: boolean;
  is_trusted?: boolean;
  verified_in_lan?: boolean;
  certificate_serial?: string;
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
  browser_engine?: string;
  connection_mode?: string;
  ip?: string;
  user_agent?: string;
  app_version?: string;
  install_id?: string;
  full_access?: boolean;
  first_seen?: string;
  last_seen?: string;
  is_current_client?: boolean;
}

export interface ObservedIpEntry {
  ip: string;
  mode?: string;
  first_seen?: string;
  last_seen?: string;
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
  physical_key?: string;
  certificate_serial?: string;
  certificate_scope?: string;
  first_seen?: string;
  last_seen?: string;
  lan_verified_at?: string;
  local_ip?: string;
  last_external_ip?: string;
  observed_ips?: ObservedIpEntry[];
  installation_ids?: string[];
  os_info?: string;
  architecture?: string;
  hostname?: string;
  mac_address?: string;
  model?: string;
  manufacturer?: string;
  connection_mode?: string;
  verified_in_lan?: boolean;
  trusted?: boolean;
  is_current?: boolean;
  client_version?: string;
  root_access?: boolean;
  root_method?: string;
  device_telemetry?: Record<string, unknown>;
}

export interface ServiceConsoleLogEntry {
  id: number;
  ts: number;
  time_str: string;
  level: 'INFO' | 'CMD' | 'HTTP' | 'OTA' | 'WARN' | 'ERROR' | string;
  source: string;
  command: string;
  message: string;
}

export interface ServiceConsoleLogsResponse {
  ok: boolean;
  read_only: boolean;
  retention_hours: number;
  window: string;
  last_id: number;
  total_24h: number;
  entries: ServiceConsoleLogEntry[];
  error?: string;
}

export interface GithubNativeAssetInfo {
  version: string;
  local_version: string;
  asset_name: string;
  download_url: string;
  size_bytes: number;
  published_at: string;
  tag_name: string;
  available: boolean;
  update_available: boolean;
}

export interface GithubNativeReleasesPayload {
  ok: boolean;
  is_ubuntu_native?: boolean;
  downloads_dir?: string;
  repo: string;
  repo_url: string;
  server_version: string;
  local_ubuntu_version: string;
  local_android_version: string;
  github_reachable: boolean;
  tag_name: string;
  release_name: string;
  release_url: string;
  published_at: string;
  sha256_url: string;
  deb: GithubNativeAssetInfo;
  apk: GithubNativeAssetInfo;
  checked_at: number;
  error?: string;
}

export interface AiSystemFaultInsight {
  signature: string;
  unit: string;
  category: string;
  title: string;
  danger_level: 'critical' | 'high' | 'medium' | 'low' | string;
  summary: string;
  solution: string;
  confidence: number;
  model?: string;
  occurrence_count?: number;
  first_seen_at?: number;
  analyzed_at: number;
  cached_from_db?: boolean;
}

export interface AiSimplifyFaultsResponse {
  status: string;
  ai_fault_insights: Record<string, AiSystemFaultInsight>;
  ai_fault_history?: AiSystemFaultInsight[];
  cached_count: number;
  newly_analyzed_count: number;
  total_count: number;
  model?: string;
  error?: string;
  error_key?: string;
}

export interface SystemErrorLogEntry {
  id?: string;
  ts?: number;
  timestamp?: string;
  time_str?: string;
  time_iso?: string;
  date_str?: string;
  unit?: string;
  source?: string;
  container?: string;
  category?: string;
  level?: string;
  priority?: number;
  message?: string;
  signature?: string;
  ai_insight?: AiSystemFaultInsight;
}

export interface FailedSystemdUnit {
  unit: string;
  active?: string;
  sub?: string;
  description?: string;
  signature?: string;
  ai_insight?: AiSystemFaultInsight;
}

export interface SystemErrorsSummary {
  total?: number;
  total_errors?: number;
  log_errors_count?: number;
  failed_units_count?: number;
  failed_units?: Array<FailedSystemdUnit | string>;
  ack_ts?: number | null;
  ack_time_str?: string | null;
  counts_by_category?: Record<string, number>;
  ai_fault_insights?: Record<string, AiSystemFaultInsight>;
  ai_fault_history?: AiSystemFaultInsight[];
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

export interface UbuntuNativeWindowState {
  is_fullscreen?: boolean;
  is_maximized?: boolean;
}

export interface UbuntuNativeControlPayload {
  ok?: boolean;
  app_version?: string;
  app_display_version?: string;
  connection_mode?: 'LAN' | 'WAN' | 'LOCAL' | 'REVOKED' | 'DISCONNECTED' | string;
  active_url?: string;
  saved_host?: string;
  node_port?: number;
  wan_domain?: string;
  has_token?: boolean;
  is_revoked?: boolean;
  local_node?: {
    installed?: boolean;
    running?: boolean;
    lan_ip?: string;
    port?: number;
    lan_url?: string;
    app_installed_deb?: boolean;
    installed_deb_version?: string;
  };
  window?: UbuntuNativeWindowState;
  about?: {
    name?: string;
    version?: string;
    display_version?: string;
    repo_url?: string;
    license?: string;
  };
}

declare global {
  interface Window {
    __INITIAL_APP_VERSION__?: string;
    __INITIAL_DISPLAY_VERSION__?: string;
    __INITIAL_APP_HASH__?: string;
    __RECURSOS_UBUNTU_NATIVE__?: boolean;
    __RECURSOS_UBUNTU_APP_VERSION__?: string;
    __RECURSOS_WINDOW_STATE__?: UbuntuNativeWindowState;
    __RECURSOS_ANDROID_NATIVE__?: boolean;
    __RECURSOS_ANDROID_TV__?: boolean;
    __RECURSOS_DEVICE_TOKEN__?: string;
    __RECURSOS_CONN_MODE__?: string;
    __RECURSOS_NODE_URL__?: string;
    __RECURSOS_DEVICE_TELEMETRY__?: Record<string, unknown>;
    __RECURSOS_INITIAL_THEME__?: ThemeMode;
    AndroidBridge?: {
      getAppVersion?: () => string;
      reconnect?: () => void;
    };
    RecursosAndroidBridge?: {
      getDeviceToken?: () => string;
      onTokenUpdated?: (token: string) => void;
      onThemeChanged?: (theme: ThemeMode) => void;
      onThemePaletteChanged?: (theme: ThemeMode, themeId: string, canvas: string, accent: string) => void;
      getPreferredTheme?: () => string;
      getConnectionMode?: () => string;
      getActiveNodeUrl?: () => string;
      getDeviceTelemetryJson?: () => string;
      isTelevision?: () => boolean;
      triggerNodeRescan?: () => void;
    };
    webkit?: {
      messageHandlers?: {
        recursosNative?: {
          postMessage: (msg: unknown) => void;
        };
        recursosTheme?: {
          postMessage: (msg: unknown) => void;
        };
        recursosWindow?: {
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
