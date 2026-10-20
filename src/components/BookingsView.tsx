import React, { useState } from 'react';
import { 
  CalendarCheck2, 
  Plus, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Calendar, 
  User, 
  MapPin, 
  AlertCircle
} from 'lucide-react';
import { BookingRequest, Department } from '../types/resources';

interface BookingsViewProps {
  bookings: BookingRequest[];
  onApproveBooking: (id: string) => void;
  onRejectBooking: (id: string) => void;
  onOpenBookingModal: () => void;
  selectedDepartment: Department | 'all';
}

export const BookingsView: React.FC<BookingsViewProps> = ({
  bookings,
  onApproveBooking,
  onRejectBooking,
  onOpenBookingModal,
  selectedDepartment
}) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const filteredBookings = bookings.filter((b) => {
    if (selectedDepartment !== 'all' && b.department !== selectedDepartment) {
      return false;
    }
    if (statusFilter !== 'all' && b.status !== statusFilter) {
      return false;
    }
    return true;
  });

  const pendingCount = bookings.filter(b => b.status === 'pending').length;
  const approvedCount = bookings.filter(b => b.status === 'approved').length;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Reservas & Solicitud de Recursos Compartidos
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Gestión de salas de juntas, laboratorios, hardware de pruebas y clusters de cómputo.
          </p>
        </div>

        <button
          onClick={onOpenBookingModal}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer self-start sm:self-auto shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Nueva Reserva</span>
        </button>
      </div>

      {/* KPI Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Solicitudes Pendientes</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-amber-600">{pendingCount}</span>
            <span className="text-xs text-slate-500">requieren validación</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Reservas Aprobadas</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-600">{approvedCount}</span>
            <span className="text-xs text-slate-500">activas en calendario</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Total Solicitudes</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{bookings.length}</span>
            <span className="text-xs text-slate-500">registradas</span>
          </div>
        </div>
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-1.5 p-1 bg-white border border-slate-200 rounded-lg w-fit">
        <span className="text-xs font-semibold text-slate-500 px-2.5">Estado:</span>
        {[
          { id: 'all', label: 'Todas' },
          { id: 'pending', label: `Pendientes (${pendingCount})` },
          { id: 'approved', label: 'Aprobadas' },
          { id: 'rejected', label: 'Rechazadas' }
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id as any)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              statusFilter === f.id
                ? 'bg-slate-900 text-white font-semibold shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Bookings List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        {filteredBookings.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500">
            <CalendarCheck2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-800">No hay reservas en este estado.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredBookings.map((b) => (
              <div 
                key={b.id}
                className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{b.resourceName}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      b.status === 'approved' 
                        ? 'bg-emerald-50 text-emerald-700' 
                        : b.status === 'pending'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-rose-50 text-rose-700'
                    }`}>
                      {b.status === 'approved' ? 'Aprobada' : b.status === 'pending' ? 'Pendiente' : 'Rechazada'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">{b.reason}</p>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 pt-1">
                    <span className="flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <strong>{b.requestedBy}</strong> ({b.department})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {b.startDate.replace('T', ' ')} hasta {b.endDate.replace('T', ' ')}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Creada el {b.createdAt}
                    </span>
                  </div>
                </div>

                {/* Direct Action buttons */}
                {b.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <button
                      onClick={() => onRejectBooking(b.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => onApproveBooking(b.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
                    >
                      Aprobar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
