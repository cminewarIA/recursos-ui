import React, { useState, useRef, useEffect } from 'react';
import { 
  Menu, 
  Search, 
  Plus, 
  Download, 
  Bell, 
  CalendarPlus, 
  CheckCircle2, 
  AlertTriangle,
  X,
  FileSpreadsheet,
  FileJson
} from 'lucide-react';
import { OptimizationAlert, Department } from '../types/resources';

interface HeaderProps {
  onOpenMobileMenu: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenNewResourceModal: () => void;
  onOpenBookingModal: () => void;
  alerts: OptimizationAlert[];
  selectedDepartment: Department | 'all';
  onExportCSV: () => void;
  onExportJSON: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMobileMenu,
  searchQuery,
  onSearchChange,
  onOpenNewResourceModal,
  onOpenBookingModal,
  alerts,
  selectedDepartment,
  onExportCSV,
  onExportJSON
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-16 px-4 md:px-8 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-30">
      {/* Left: Mobile hamburger & Search bar */}
      <div className="flex items-center gap-3 flex-1 max-w-xl">
        <button
          onClick={onOpenMobileMenu}
          aria-label="Abrir menú"
          className="lg:hidden p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por recurso, SKU, responsable o etiqueta..."
            className="w-full pl-9 pr-8 py-2 bg-slate-50 hover:bg-slate-100/70 focus:bg-white text-xs md:text-sm text-slate-900 border border-slate-200 rounded-lg placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2 md:gap-3">
        {selectedDepartment !== 'all' && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md">
            <span>Área: {selectedDepartment}</span>
          </div>
        )}

        {/* Export dropdown */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
            title="Exportar datos del panel"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Exportar</span>
          </button>

          {showExportMenu && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  onExportCSV();
                  setShowExportMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Descargar en CSV</span>
              </button>
              <button
                onClick={() => {
                  onExportJSON();
                  setShowExportMenu(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left cursor-pointer"
              >
                <FileJson className="w-4 h-4 text-amber-600" />
                <span>Descargar en JSON</span>
              </button>
            </div>
          )}
        </div>

        {/* Notifications Popover */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            aria-label="Notificaciones y alertas"
            className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {alerts.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full ring-2 ring-white" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-xl shadow-xl py-3 z-50">
              <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-bold text-slate-900">Alertas de Recursos ({alerts.length})</span>
                </div>
                <span className="text-[11px] text-slate-500">Optimización activa</span>
              </div>

              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 px-2">
                {alerts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 flex flex-col items-center gap-1.5">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>No hay alertas pendientes en este momento.</span>
                  </div>
                ) : (
                  alerts.map((alt) => (
                    <div key={alt.id} className="p-3 hover:bg-slate-50 rounded-lg transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900">{alt.title}</span>
                        {alt.potentialSavingsMonthly ? (
                          <span className="text-[11px] font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                            +€{alt.potentialSavingsMonthly}/m
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-600 leading-relaxed">{alt.description}</p>
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                        <span>{alt.resourceName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{alt.severity} prioridad</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quick Booking Button */}
        <button
          onClick={onOpenBookingModal}
          className="hidden md:flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
        >
          <CalendarPlus className="w-3.5 h-3.5 text-indigo-600" />
          <span>Reservar</span>
        </button>

        {/* New Resource CTA */}
        <button
          onClick={onOpenNewResourceModal}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs active:scale-[0.99]"
        >
          <Plus className="w-4 h-4" />
          <span>Nuevo Recurso</span>
        </button>
      </div>
    </header>
  );
};
