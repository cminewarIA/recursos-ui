import React, { useState } from 'react';
import { 
  Boxes, 
  TrendingUp, 
  CreditCard, 
  CheckCircle, 
  Clock, 
  ArrowUpRight, 
  Calendar, 
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  ChevronRight,
  HardDrive
} from 'lucide-react';
import { Resource, BookingRequest, OptimizationAlert, Department } from '../types/resources';
import { NavTab } from './Sidebar';

interface OverviewViewProps {
  resources: Resource[];
  bookings: BookingRequest[];
  alerts: OptimizationAlert[];
  onNavigateTab: (tab: NavTab) => void;
  onApproveBooking: (id: string) => void;
  onRejectBooking: (id: string) => void;
  onSelectResource: (res: Resource) => void;
  selectedDepartment: Department | 'all';
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  resources,
  bookings,
  alerts,
  onNavigateTab,
  onApproveBooking,
  onRejectBooking,
  onSelectResource,
  selectedDepartment
}) => {
  const [hoveredPoint, setHoveredPoint] = useState<{ day: string; value: number; x: number; y: number } | null>(null);

  // Filtered by selected department if any
  const filteredResources = selectedDepartment === 'all' 
    ? resources 
    : resources.filter(r => r.department === selectedDepartment);

  // Key metrics calculation
  const totalUnits = filteredResources.reduce((acc, r) => acc + r.totalQuantity, 0);
  const availableUnits = filteredResources.reduce((acc, r) => acc + r.availableQuantity, 0);
  const totalCostMonthly = filteredResources.reduce((acc, r) => acc + r.costMonthly, 0);
  const avgUtilization = filteredResources.length > 0 
    ? Math.round(filteredResources.reduce((acc, r) => acc + r.utilizationRate, 0) / filteredResources.length) 
    : 0;

  const pendingBookings = bookings.filter(b => b.status === 'pending');

  // Breakdown by category
  const categoriesCount = {
    hardware: filteredResources.filter(r => r.category === 'hardware').length,
    software: filteredResources.filter(r => r.category === 'software').length,
    cloud: filteredResources.filter(r => r.category === 'cloud').length,
    facility: filteredResources.filter(r => r.category === 'facility').length,
    human: filteredResources.filter(r => r.category === 'human').length
  };

  // Weekly utilization data curve (7 days)
  const weeklyTrends = [
    { day: 'Lun', value: 72 },
    { day: 'Mar', value: 78 },
    { day: 'Mié', value: 85 },
    { day: 'Jue', value: 82 },
    { day: 'Vie', value: 79 },
    { day: 'Sáb', value: 41 },
    { day: 'Dom', value: 36 }
  ];

  // SVG Chart Dimensions
  const svgWidth = 560;
  const svgHeight = 160;
  const paddingX = 40;
  const paddingY = 30;
  const graphWidth = svgWidth - paddingX * 2;
  const graphHeight = svgHeight - paddingY * 2;

  // Compute polyline coordinates
  const points = weeklyTrends.map((point, index) => {
    const x = paddingX + (index / (weeklyTrends.length - 1)) * graphWidth;
    const y = svgHeight - paddingY - ((point.value - 20) / (100 - 20)) * graphHeight;
    return { ...point, x, y };
  });

  const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPath = `M ${points[0].x},${svgHeight - paddingY} ` +
    points.map(p => `L ${p.x},${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x},${svgHeight - paddingY} Z`;

  return (
    <div className="space-y-6">
      {/* Top Welcome & Subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Resumen de Recursos Operativos
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Supervisión en tiempo real de activos tecnológicos, licencias, capacidad de infraestructura y personal.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-slate-600">Sistema Operativo al 100%</span>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Recursos Totales</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Boxes className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{filteredResources.length}</span>
            <span className="text-xs text-slate-500 font-medium">tipos / {totalUnits} unidades</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-emerald-600 font-semibold flex items-center">
              <ArrowUpRight className="w-3.5 h-3.5" /> +8.4%
            </span>
            <span className="text-slate-500">frente al trimestre anterior</span>
          </div>
        </div>

        {/* KPI 2 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Tasa de Utilización</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{avgUtilization}%</span>
            <span className="text-xs text-slate-500 font-medium">media ponderada</span>
          </div>
          <div className="mt-2.5">
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${
                  avgUtilization > 85 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${avgUtilization}%` }}
              />
            </div>
          </div>
        </div>

        {/* KPI 3 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Inversión Mensual</span>
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              €{totalCostMonthly.toLocaleString('es-ES')}
            </span>
            <span className="text-xs text-slate-500 font-medium">/ mes</span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-slate-500">Presupuesto mensual:</span>
            <span className="font-semibold text-slate-800">€15.000 (76% ejecutado)</span>
          </div>
        </div>

        {/* KPI 4 */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 tracking-wide uppercase">Disponibilidad Inmediata</span>
            <div className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center text-sky-600">
              <CheckCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{availableUnits}</span>
            <span className="text-xs text-slate-500 font-medium">activos disponibles</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs text-slate-500">
            <span>{pendingBookings.length} solicitudes pendientes</span>
            <span aria-hidden="true">·</span>
            <span>{alerts.length} alertas</span>
          </div>
        </div>
      </div>

      {/* Main Charts & Analytics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Utilization Trend Graph (2 Columns) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Curva de Ocupación Semanal (%)</h2>
              <p className="text-xs text-slate-500">Demanda de recursos y activos en días laborables y fines de semana</p>
            </div>
            <span className="text-xs font-mono font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100">
              Semana Actual
            </span>
          </div>

          {/* Responsive SVG Chart */}
          <div className="relative w-full overflow-hidden">
            <svg 
              viewBox={`0 0 ${svgWidth} ${svgHeight}`} 
              className="w-full h-44 overflow-visible select-none"
            >
              <defs>
                <linearGradient id="gradientArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid lines */}
              {[30, 60, 90].map((val) => {
                const y = svgHeight - paddingY - ((val - 20) / (100 - 20)) * graphHeight;
                return (
                  <g key={val}>
                    <line
                      x1={paddingX}
                      y1={y}
                      x2={svgWidth - paddingX}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                    <text
                      x={paddingX - 8}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="9"
                      fill="#94a3b8"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {val}%
                    </text>
                  </g>
                );
              })}

              {/* Area */}
              <path d={areaPath} fill="url(#gradientArea)" />

              {/* Polyline line */}
              <polyline
                fill="none"
                stroke="#4f46e5"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={polylinePoints}
              />

              {/* Interactive Data Points */}
              {points.map((p) => (
                <g key={p.day}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={hoveredPoint?.day === p.day ? 6 : 4}
                    fill={hoveredPoint?.day === p.day ? '#4338ca' : '#ffffff'}
                    stroke="#4f46e5"
                    strokeWidth="2.5"
                    className="cursor-pointer transition-all duration-150"
                    onMouseEnter={() => setHoveredPoint(p)}
                    onMouseLeave={() => setHoveredPoint(null)}
                  />
                  <text
                    x={p.x}
                    y={svgHeight - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="500"
                    fill="#64748b"
                  >
                    {p.day}
                  </text>
                </g>
              ))}
            </svg>

            {/* Hover Tooltip */}
            {hoveredPoint && (
              <div 
                className="absolute pointer-events-none bg-slate-900 text-white text-[11px] px-2.5 py-1 rounded shadow-md font-mono"
                style={{ 
                  left: `${(hoveredPoint.x / svgWidth) * 100}%`, 
                  top: `${(hoveredPoint.y / svgHeight) * 100 - 25}%`,
                  transform: 'translate(-50%, -100%)' 
                }}
              >
                {hoveredPoint.day}: {hoveredPoint.value}% utilización
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600 inline-block" /> Ocupación de servidores y puestos
            </span>
            <span>Pico máximo: Miércoles (85%)</span>
          </div>
        </div>

        {/* Category Breakdown (1 Column) */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Distribución por Categoría</h2>
            <p className="text-xs text-slate-500">Tipos de recursos catalogados en el sistema</p>
          </div>

          <div className="my-4 space-y-3">
            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-slate-500" /> Hardware & Equipos
                </span>
                <span className="font-mono text-slate-900">{categoriesCount.hardware}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div 
                  className="bg-indigo-600 h-2 rounded-full" 
                  style={{ width: `${(categoriesCount.hardware / (filteredResources.length || 1)) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Software & Licencias</span>
                <span className="font-mono text-slate-900">{categoriesCount.software}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div 
                  className="bg-emerald-600 h-2 rounded-full" 
                  style={{ width: `${(categoriesCount.software / (filteredResources.length || 1)) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Cloud & Infraestructura</span>
                <span className="font-mono text-slate-900">{categoriesCount.cloud}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div 
                  className="bg-sky-600 h-2 rounded-full" 
                  style={{ width: `${(categoriesCount.cloud / (filteredResources.length || 1)) * 100}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                <span>Espacios & Instalaciones</span>
                <span className="font-mono text-slate-900">{categoriesCount.facility}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div 
                  className="bg-amber-600 h-2 rounded-full" 
                  style={{ width: `${(categoriesCount.facility / (filteredResources.length || 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={() => onNavigateTab('inventory')}
            className="w-full py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <span>Ver Inventario Completo</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
      </div>

      {/* Two Columns: Pending Bookings & Critical Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Requests */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">Solicitudes de Reserva Pendientes</h2>
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {pendingBookings.length} por validar
            </span>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {pendingBookings.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-500" />
                <p>No hay solicitudes de recursos pendientes de aprobación.</p>
              </div>
            ) : (
              pendingBookings.map((b) => (
                <div key={b.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{b.resourceName}</span>
                      <span className="text-[11px] text-slate-500 font-medium">({b.department})</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{b.reason}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Solicitado por: <strong className="text-slate-700">{b.requestedBy}</strong></span>
                      <span aria-hidden="true">·</span>
                      <span>Fecha: {b.startDate.replace('T', ' ')}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => onRejectBooking(b.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-slate-200 rounded-md transition-colors cursor-pointer"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => onApproveBooking(b.id)}
                      className="px-2.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors cursor-pointer"
                    >
                      Aprobar
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Priority Resources & Maintenance Due */}
        <div className="bg-white p-5 rounded-xl border border-slate-200/80 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <h2 className="text-sm font-bold text-slate-900">Activos Críticos & Mantenimiento</h2>
            </div>
            <button
              onClick={() => onNavigateTab('optimization')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              <span>Optimizar</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mt-3 divide-y divide-slate-100">
            {filteredResources
              .filter(r => r.status === 'maintenance' || r.utilizationRate > 85 || r.utilizationRate < 35)
              .slice(0, 4)
              .map((res) => (
                <div 
                  key={res.id} 
                  onClick={() => onSelectResource(res)}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{res.name}</span>
                      <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                        {res.skuOrCode}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                      <span>Área: {res.department}</span>
                      <span aria-hidden="true">·</span>
                      <span>Uso: {res.utilizationRate}%</span>
                      {res.status === 'maintenance' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-700 font-medium">Revisión requerida</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono font-bold text-slate-800">
                      €{res.costMonthly}/m
                    </span>
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      {res.availableQuantity}/{res.totalQuantity} disp.
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
