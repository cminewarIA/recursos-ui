import React from 'react';
import { 
  X, 
  Edit3, 
  Trash2, 
  Calendar, 
  MapPin, 
  DollarSign, 
  Boxes, 
  User, 
  Briefcase, 
  Clock, 
  CheckCircle2, 
  ShieldCheck,
  Tag
} from 'lucide-react';
import { Resource } from '../types/resources';

interface ResourceDetailModalProps {
  resource: Resource | null;
  onClose: () => void;
  onEdit: (resource: Resource) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (resource: Resource) => void;
  onBookResource: (resource: Resource) => void;
}

export const ResourceDetailModal: React.FC<ResourceDetailModalProps> = ({
  resource,
  onClose,
  onEdit,
  onDelete,
  onToggleStatus,
  onBookResource
}) => {
  if (!resource) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-semibold uppercase">
              {resource.skuOrCode} · {resource.categoryLabel}
            </span>
            <h2 className="text-lg font-bold text-slate-900 mt-1.5">{resource.name}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span>Área: {resource.department}</span>
              <span aria-hidden="true">·</span>
              <span>Comprado: {resource.purchaseDate}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 text-xs">
          {/* Status & Quantities */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <span className="text-slate-500 block text-[11px]">Estado Actual:</span>
              <span className="font-bold text-slate-900 text-sm mt-0.5 block">{resource.statusLabel}</span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Disponibilidad:</span>
              <span className="font-bold text-slate-900 text-sm mt-0.5 block">
                {resource.availableQuantity} / {resource.totalQuantity} unidades
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Coste Mensual:</span>
              <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                €{resource.costMonthly}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[11px]">Tasa de Ocupación:</span>
              <span className="font-mono font-bold text-slate-900 text-sm mt-0.5 block">
                {resource.utilizationRate}%
              </span>
            </div>
          </div>

          {/* Location & Specs */}
          {resource.location && (
            <div className="flex items-start gap-2 text-slate-700">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-slate-900">Ubicación Física / Servidor:</span>
                <span className="text-slate-600">{resource.location}</span>
              </div>
            </div>
          )}

          <div>
            <span className="font-semibold block text-slate-900 mb-1">Especificaciones Técnicas:</span>
            <p className="text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200 font-mono text-[11px]">
              {resource.specifications}
            </p>
          </div>

          {/* Current Assignment */}
          <div className="pt-2 border-t border-slate-100">
            <span className="font-semibold block text-slate-900 mb-1">Responsable & Proyecto:</span>
            {resource.assignedTo ? (
              <div className="flex items-center justify-between text-slate-700 bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                <div>
                  <div className="font-bold text-slate-900">{resource.assignedTo}</div>
                  <div className="text-[11px] text-slate-500">{resource.assignedRole || 'Personal asignado'}</div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-indigo-900">{resource.project || 'General'}</div>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 italic">No tiene asignación directa actualmente.</p>
            )}
          </div>

          {/* Tags */}
          {resource.tags && resource.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {resource.tags.map(t => (
                <span key={t} className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => {
              if (confirm('¿Eliminar este recurso del inventario?')) {
                onDelete(resource.id);
                onClose();
              }
            }}
            className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Eliminar</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onBookResource(resource);
                onClose();
              }}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
            >
              Reservar
            </button>
            <button
              onClick={() => {
                onEdit(resource);
                onClose();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer shadow-xs"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Editar</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
