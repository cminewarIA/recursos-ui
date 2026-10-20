import React from 'react';
import { 
  LayoutDashboard, 
  Boxes, 
  Users, 
  CalendarCheck2, 
  TrendingDown, 
  Layers, 
  ChevronRight,
  ShieldAlert,
  Server
} from 'lucide-react';
import { Department } from '../types/resources';

export type NavTab = 'overview' | 'inventory' | 'capacity' | 'bookings' | 'optimization';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingBookingsCount: number;
  alertsCount: number;
  selectedDepartment: Department | 'all';
  onSelectDepartment: (dept: Department | 'all') => void;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  pendingBookingsCount,
  alertsCount,
  selectedDepartment,
  onSelectDepartment,
  isMobileOpen,
  onCloseMobile
}) => {
  const navItems = [
    {
      id: 'overview' as NavTab,
      label: 'Resumen Ejecutivo',
      icon: LayoutDashboard,
      badge: null
    },
    {
      id: 'inventory' as NavTab,
      label: 'Inventario de Recursos',
      icon: Boxes,
      badge: null
    },
    {
      id: 'capacity' as NavTab,
      label: 'Capacidad de Equipo',
      icon: Users,
      badge: null
    },
    {
      id: 'bookings' as NavTab,
      label: 'Reservas y Solicitudes',
      icon: CalendarCheck2,
      badge: pendingBookingsCount > 0 ? pendingBookingsCount : null
    },
    {
      id: 'optimization' as NavTab,
      label: 'Costes y Optimización',
      icon: TrendingDown,
      badge: alertsCount > 0 ? alertsCount : null
    }
  ];

  const departments: (Department | 'all')[] = [
    'all',
    'Ingeniería',
    'Diseño',
    'Sistemas',
    'Marketing',
    'Finanzas',
    'Operaciones'
  ];

  const getDeptLabel = (d: Department | 'all') => {
    if (d === 'all') return 'Todas las áreas';
    return d;
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden backdrop-blur-xs"
        />
      )}

      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out
        lg:static lg:translate-x-0
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Brand Header */}
        <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-100">
          <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-xs">
            <Server className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-bold tracking-tight text-slate-900">Recursos<span className="text-indigo-600">Hub</span></span>
            <span className="text-[11px] text-slate-500 font-medium">Gestión y Capacidad</span>
          </div>
        </div>

        {/* Navigation list */}
        <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
            Panel Principal
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer text-left ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-300' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}

          {/* Department Filter Section */}
          <div className="pt-6">
            <div className="px-3 pb-2 flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-600 uppercase">
              <span>Filtrar por Área</span>
              <Layers className="w-3.5 h-3.5 text-slate-500" />
            </div>
            <div className="space-y-0.5">
              {departments.map((dept) => {
                const isSelected = selectedDepartment === dept;
                return (
                  <button
                    key={dept}
                    onClick={() => {
                      onSelectDepartment(dept);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-md transition-colors cursor-pointer text-left ${
                      isSelected
                        ? 'bg-indigo-50 text-indigo-900 font-semibold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <span>{getDeptLabel(dept)}</span>
                    {isSelected && <ChevronRight className="w-3.5 h-3.5 text-indigo-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Status / Summary box */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/70">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-slate-600">
              <p className="font-semibold text-slate-900">Auditoría en Línea</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {alertsCount} recomendaciones de optimización detectadas.
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
