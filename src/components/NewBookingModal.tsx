import React, { useState, useEffect } from 'react';
import { X, CalendarCheck2, Clock, User, Building } from 'lucide-react';
import { Resource, BookingRequest, Department } from '../types/resources';

interface NewBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  resources: Resource[];
  initialResource?: Resource | null;
  onAddBooking: (booking: Omit<BookingRequest, 'id' | 'createdAt'>) => void;
}

export const NewBookingModal: React.FC<NewBookingModalProps> = ({
  isOpen,
  onClose,
  resources,
  initialResource,
  onAddBooking
}) => {
  const [selectedResourceId, setSelectedResourceId] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [department, setDepartment] = useState<Department>('Ingeniería');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (initialResource) {
      setSelectedResourceId(initialResource.id);
      setDepartment(initialResource.department);
    } else if (resources.length > 0 && !selectedResourceId) {
      setSelectedResourceId(resources[0].id);
    }

    // Default dates (tomorrow 09:00 to 14:00)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    setStartDate(`${dateStr}T09:00`);
    setEndDate(`${dateStr}T17:00`);
  }, [initialResource, resources, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const resource = resources.find(r => r.id === selectedResourceId);
    if (!resource || !requestedBy.trim() || !reason.trim()) return;

    onAddBooking({
      resourceId: resource.id,
      resourceName: resource.name,
      category: resource.category,
      requestedBy: requestedBy.trim(),
      department,
      startDate,
      endDate,
      reason: reason.trim(),
      status: 'pending'
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarCheck2 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">Solicitar Reserva de Recurso</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Seleccionar Recurso *</label>
            <select
              value={selectedResourceId}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
            >
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.categoryLabel} - {r.availableQuantity} disp.)
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Solicitado por (Nombre) *</label>
              <input
                type="text"
                required
                value={requestedBy}
                onChange={(e) => setRequestedBy(e.target.value)}
                placeholder="Ej. Andrés Gil"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Área / Departamento</label>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value as Department)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="Ingeniería">Ingeniería</option>
                <option value="Diseño">Diseño</option>
                <option value="Sistemas">Sistemas</option>
                <option value="Marketing">Marketing</option>
                <option value="Finanzas">Finanzas</option>
                <option value="Operaciones">Operaciones</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Fecha y Hora Inicio *</label>
              <input
                type="datetime-local"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Fecha y Hora Fin *</label>
              <input
                type="datetime-local"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-slate-700 block mb-1">Motivo / Caso de Uso *</label>
            <textarea
              required
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica para qué necesitas reservar este recurso (cliente, prueba, demo, etc.)"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              Enviar Solicitud
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
