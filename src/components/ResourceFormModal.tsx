import React, { useState, useEffect } from 'react';
import { X, Layers, Boxes, DollarSign, Calendar, Tag, HardDrive } from 'lucide-react';
import { Resource, ResourceCategory, ResourceStatus, Department } from '../types/resources';

interface ResourceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (resourceData: Omit<Resource, 'id'> | Resource) => void;
  initialData?: Resource | null;
}

export const ResourceFormModal: React.FC<ResourceFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData
}) => {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ResourceCategory>('hardware');
  const [skuOrCode, setSkuOrCode] = useState('');
  const [department, setDepartment] = useState<Department>('Ingeniería');
  const [status, setStatus] = useState<ResourceStatus>('available');
  const [assignedTo, setAssignedTo] = useState('');
  const [assignedRole, setAssignedRole] = useState('');
  const [project, setProject] = useState('');
  const [costMonthly, setCostMonthly] = useState(150);
  const [totalQuantity, setTotalQuantity] = useState(1);
  const [availableQuantity, setAvailableQuantity] = useState(1);
  const [location, setLocation] = useState('');
  const [specifications, setSpecifications] = useState('');
  const [tagsString, setTagsString] = useState('');
  const [utilizationRate, setUtilizationRate] = useState(60);

  useEffect(() => {
    if (initialData) {
      setName(initialData.name);
      setCategory(initialData.category);
      setSkuOrCode(initialData.skuOrCode);
      setDepartment(initialData.department);
      setStatus(initialData.status);
      setAssignedTo(initialData.assignedTo || '');
      setAssignedRole(initialData.assignedRole || '');
      setProject(initialData.project || '');
      setCostMonthly(initialData.costMonthly);
      setTotalQuantity(initialData.totalQuantity);
      setAvailableQuantity(initialData.availableQuantity);
      setLocation(initialData.location || '');
      setSpecifications(initialData.specifications);
      setTagsString(initialData.tags ? initialData.tags.join(', ') : '');
      setUtilizationRate(initialData.utilizationRate);
    } else {
      // Reset defaults
      setName('');
      setCategory('hardware');
      setSkuOrCode(`RES-${Math.floor(1000 + Math.random() * 9000)}`);
      setDepartment('Ingeniería');
      setStatus('available');
      setAssignedTo('');
      setAssignedRole('');
      setProject('');
      setCostMonthly(120);
      setTotalQuantity(1);
      setAvailableQuantity(1);
      setLocation('');
      setSpecifications('');
      setTagsString('');
      setUtilizationRate(50);
    }
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const categoryLabels: Record<ResourceCategory, string> = {
      hardware: 'Hardware & Equipos',
      software: 'Software & Licencias',
      cloud: 'Cloud & Computación',
      facility: 'Espacios & Instalaciones',
      human: 'Talento & Personal'
    };

    const statusLabels: Record<ResourceStatus, string> = {
      available: 'Disponible',
      allocated: 'Asignado',
      maintenance: 'En Mantenimiento',
      reserved: 'Reservado'
    };

    const tags = tagsString
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const resourcePayload: any = {
      name: name.trim(),
      category,
      categoryLabel: categoryLabels[category],
      skuOrCode: skuOrCode.trim() || `RES-${Date.now().toString().slice(-4)}`,
      department,
      status,
      statusLabel: statusLabels[status],
      assignedTo: assignedTo.trim() || undefined,
      assignedRole: assignedRole.trim() || undefined,
      project: project.trim() || undefined,
      costMonthly: Number(costMonthly) || 0,
      totalQuantity: Number(totalQuantity) || 1,
      availableQuantity: Number(availableQuantity) || 0,
      location: location.trim() || undefined,
      specifications: specifications.trim() || 'Sin especificaciones detalladas.',
      purchaseDate: initialData?.purchaseDate || new Date().toISOString().split('T')[0],
      maintenanceDate: initialData?.maintenanceDate,
      utilizationRate: Number(utilizationRate) || 0,
      tags
    };

    if (initialData?.id) {
      resourcePayload.id = initialData.id;
    }

    onSave(resourcePayload);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden my-6">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-900">
              {initialData ? 'Editar Recurso' : 'Registrar Nuevo Recurso'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* Row 1: Name and SKU */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="font-semibold text-slate-700 block mb-1">Nombre del Recurso *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. MacBook Pro M3 Max o Licencia Jira Cloud"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Código / SKU</label>
              <input
                type="text"
                value={skuOrCode}
                onChange={(e) => setSkuOrCode(e.target.value)}
                placeholder="SRV-01"
                className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          {/* Row 2: Category and Department */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Categoría</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ResourceCategory)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="hardware">Hardware & Equipos</option>
                <option value="software">Software & Licencias</option>
                <option value="cloud">Cloud & Infraestructura</option>
                <option value="facility">Espacios & Instalaciones</option>
              </select>
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

          {/* Row 3: Status, Quantities */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Estado</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ResourceStatus)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="available">Disponible</option>
                <option value="allocated">Asignado</option>
                <option value="maintenance">En Mantenimiento</option>
                <option value="reserved">Reservado</option>
              </select>
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Cantidad Total</label>
              <input
                type="number"
                min="1"
                value={totalQuantity}
                onChange={(e) => setTotalQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Cantidad Libre / Disp.</label>
              <input
                type="number"
                min="0"
                max={totalQuantity}
                value={availableQuantity}
                onChange={(e) => setAvailableQuantity(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          {/* Row 4: Cost & Utilization */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Coste Mensual (€)</label>
              <input
                type="number"
                min="0"
                value={costMonthly}
                onChange={(e) => setCostMonthly(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Tasa de Ocupación ({utilizationRate}%)</label>
              <input
                type="range"
                min="0"
                max="100"
                value={utilizationRate}
                onChange={(e) => setUtilizationRate(Number(e.target.value))}
                className="w-full mt-2 accent-slate-900 cursor-pointer"
              />
            </div>
          </div>

          {/* Row 5: Assignment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Asignado a (Persona o Equipo)</label>
              <input
                type="text"
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Ej. Lucía Navarro"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
            <div>
              <label className="font-semibold text-slate-700 block mb-1">Proyecto Vinculado</label>
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Ej. Rediseño Portal 2026"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
            </div>
          </div>

          {/* Specifications */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Especificaciones Técnicas / Detalles</label>
            <textarea
              rows={3}
              value={specifications}
              onChange={(e) => setSpecifications(e.target.value)}
              placeholder="Detalles de hardware, versión de software, tipo de licencia, ubicación física..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="font-semibold text-slate-700 block mb-1">Etiquetas (separadas por coma)</label>
            <input
              type="text"
              value={tagsString}
              onChange={(e) => setTagsString(e.target.value)}
              placeholder="Ej. Servidores, Nube, Alta Disponibilidad"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
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
              {initialData ? 'Guardar Cambios' : 'Crear Recurso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
