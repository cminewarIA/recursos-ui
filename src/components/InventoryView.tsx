import React, { useState, useMemo } from 'react';
import { 
  Boxes, 
  LayoutGrid, 
  List, 
  Plus, 
  Trash2, 
  Edit3, 
  Eye, 
  Tag, 
  CheckCircle2, 
  Clock, 
  AlertOctagon,
  ArrowUpDown,
  Laptop,
  Layers,
  Cloud,
  Building,
  UserCheck
} from 'lucide-react';
import { Resource, ResourceCategory, ResourceStatus, Department } from '../types/resources';

interface InventoryViewProps {
  resources: Resource[];
  onSelectResource: (res: Resource) => void;
  onEditResource: (res: Resource) => void;
  onDeleteResource: (id: string) => void;
  onOpenNewResourceModal: () => void;
  searchQuery: string;
  selectedDepartment: Department | 'all';
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  resources,
  onSelectResource,
  onEditResource,
  onDeleteResource,
  onOpenNewResourceModal,
  searchQuery,
  selectedDepartment
}) => {
  const [selectedCategory, setSelectedCategory] = useState<ResourceCategory | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<ResourceStatus | 'all'>('all');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [sortBy, setSortBy] = useState<'name' | 'cost' | 'utilization' | 'date'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Filter resources
  const filteredList = useMemo(() => {
    return resources.filter((res) => {
      // Global department filter
      if (selectedDepartment !== 'all' && res.department !== selectedDepartment) {
        return false;
      }
      // Category filter
      if (selectedCategory !== 'all' && res.category !== selectedCategory) {
        return false;
      }
      // Status filter
      if (selectedStatus !== 'all' && res.status !== selectedStatus) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim() !== '') {
        const query = searchQuery.toLowerCase();
        const matchesName = res.name.toLowerCase().includes(query);
        const matchesSku = res.skuOrCode.toLowerCase().includes(query);
        const matchesAssigned = res.assignedTo ? res.assignedTo.toLowerCase().includes(query) : false;
        const matchesProject = res.project ? res.project.toLowerCase().includes(query) : false;
        const matchesTags = res.tags.some(t => t.toLowerCase().includes(query));
        if (!matchesName && !matchesSku && !matchesAssigned && !matchesProject && !matchesTags) {
          return false;
        }
      }
      return true;
    }).sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'cost') {
        comparison = a.costMonthly - b.costMonthly;
      } else if (sortBy === 'utilization') {
        comparison = a.utilizationRate - b.utilizationRate;
      } else if (sortBy === 'date') {
        comparison = a.purchaseDate.localeCompare(b.purchaseDate);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [resources, selectedDepartment, selectedCategory, selectedStatus, searchQuery, sortBy, sortDirection]);

  const toggleSort = (field: 'name' | 'cost' | 'utilization' | 'date') => {
    if (sortBy === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('asc');
    }
  };

  const getCategoryIcon = (cat: ResourceCategory) => {
    switch (cat) {
      case 'hardware': return <Laptop className="w-3.5 h-3.5 text-indigo-600" />;
      case 'software': return <Layers className="w-3.5 h-3.5 text-emerald-600" />;
      case 'cloud': return <Cloud className="w-3.5 h-3.5 text-sky-600" />;
      case 'facility': return <Building className="w-3.5 h-3.5 text-amber-600" />;
      case 'human': return <UserCheck className="w-3.5 h-3.5 text-purple-600" />;
    }
  };

  const getStatusBadge = (status: ResourceStatus) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Disponible
          </span>
        );
      case 'allocated':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            Asignado
          </span>
        );
      case 'maintenance':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Mantenimiento
          </span>
        );
      case 'reserved':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-700">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            Reservado
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header bar with controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Inventario & Catálogo de Recursos
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mostrando {filteredList.length} de {resources.length} recursos registrados
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          {/* View mode toggle */}
          <div className="p-1 bg-slate-100 rounded-lg flex items-center gap-1 border border-slate-200">
            <button
              onClick={() => setViewMode('table')}
              aria-label="Vista de tabla"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              aria-label="Vista de cuadrícula"
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                viewMode === 'grid' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>

          <button
            onClick={onOpenNewResourceModal}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Añadir Recurso</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs / Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider px-2">
            Tipo:
          </span>
          {[
            { id: 'all', label: 'Todos' },
            { id: 'hardware', label: 'Hardware' },
            { id: 'software', label: 'Software' },
            { id: 'cloud', label: 'Cloud' },
            { id: 'facility', label: 'Espacios' }
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id as ResourceCategory | 'all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                selectedCategory === cat.id
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Status Dropdown / Selectors */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="text-xs text-slate-500 font-medium">Estado:</span>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as ResourceStatus | 'all')}
            className="px-2.5 py-1.5 bg-slate-50 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
          >
            <option value="all">Cualquier estado</option>
            <option value="available">Disponible</option>
            <option value="allocated">Asignado</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="reserved">Reservado</option>
          </select>
        </div>
      </div>

      {/* Content: Table or Grid */}
      {filteredList.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Boxes className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-800">No se encontraron recursos</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            No hay recursos que coincidan con los filtros aplicados. Intenta restablecer los términos de búsqueda.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW */
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                <tr>
                  <th scope="col" className="py-3 px-4">
                    <button 
                      onClick={() => toggleSort('name')} 
                      className="flex items-center gap-1.5 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Recurso / SKU</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4">Categoría / Área</th>
                  <th scope="col" className="py-3 px-4">Estado</th>
                  <th scope="col" className="py-3 px-4">Asignación Actual</th>
                  <th scope="col" className="py-3 px-4">
                    <button 
                      onClick={() => toggleSort('utilization')} 
                      className="flex items-center gap-1.5 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Uso</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4">
                    <button 
                      onClick={() => toggleSort('cost')} 
                      className="flex items-center gap-1.5 hover:text-slate-900 cursor-pointer"
                    >
                      <span>Coste / Mes</span>
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th scope="col" className="py-3 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((res) => (
                  <tr 
                    key={res.id} 
                    className="hover:bg-slate-50/60 transition-colors group"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{res.name}</div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">{res.skuOrCode}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        {getCategoryIcon(res.category)}
                        <span>{res.categoryLabel}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{res.department}</div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getStatusBadge(res.status)}
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {res.availableQuantity} de {res.totalQuantity} libres
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      {res.assignedTo ? (
                        <div>
                          <div className="font-medium text-slate-900">{res.assignedTo}</div>
                          <div className="text-[11px] text-slate-500 truncate max-w-[160px]">{res.project || 'Proyecto general'}</div>
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">Sin asignar</span>
                      )}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-medium text-slate-900 w-8">{res.utilizationRate}%</span>
                        <div className="w-16 bg-slate-100 rounded-full h-1.5">
                          <div 
                            className={`h-1.5 rounded-full ${
                              res.utilizationRate > 85 ? 'bg-amber-500' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${res.utilizationRate}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap font-mono font-medium text-slate-900">
                      €{res.costMonthly.toLocaleString('es-ES')}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onSelectResource(res)}
                          title="Ver detalle"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onEditResource(res)}
                          title="Editar"
                          className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteResource(res.id)}
                          title="Eliminar"
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredList.map((res) => (
            <div 
              key={res.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {getCategoryIcon(res.category)}
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                      {res.categoryLabel}
                    </span>
                  </div>
                  {getStatusBadge(res.status)}
                </div>

                <h3 className="mt-2.5 text-sm font-bold text-slate-900 hover:text-indigo-600 transition-colors cursor-pointer" onClick={() => onSelectResource(res)}>
                  {res.name}
                </h3>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                  {res.skuOrCode} · {res.department}
                </p>

                <p className="mt-2 text-xs text-slate-600 line-clamp-2 leading-relaxed">
                  {res.specifications}
                </p>

                {/* Utilization & Availability */}
                <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Tasa de Ocupación:</span>
                    <span className="font-mono font-medium text-slate-900">{res.utilizationRate}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5">
                    <div 
                      className={`h-1.5 rounded-full ${
                        res.utilizationRate > 85 ? 'bg-amber-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${res.utilizationRate}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-xs text-slate-500 pt-1">
                    <span>Disponibilidad:</span>
                    <span className="font-semibold text-slate-800">{res.availableQuantity} de {res.totalQuantity} unidades</span>
                  </div>
                </div>

                {/* Tags */}
                {res.tags && res.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {res.tags.map((t) => (
                      <span key={t} className="text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Card Footer */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-500 block uppercase">Coste mensual</span>
                  <span className="text-sm font-mono font-bold text-slate-900">€{res.costMonthly}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onSelectResource(res)}
                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-colors cursor-pointer"
                  >
                    Detalle
                  </button>
                  <button
                    onClick={() => onEditResource(res)}
                    className="p-1 text-slate-500 hover:text-indigo-600 rounded-md transition-colors cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
