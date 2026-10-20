import React, { useState } from 'react';
import { 
  Users, 
  UserPlus, 
  AlertTriangle, 
  CheckCircle2, 
  Briefcase, 
  Clock, 
  SlidersHorizontal,
  ChevronDown,
  Sparkles
} from 'lucide-react';
import { TeamMember, Department } from '../types/resources';

interface TeamCapacityViewProps {
  teamMembers: TeamMember[];
  onUpdateMemberHours: (id: string, newHours: number) => void;
  onAddMember: (member: Omit<TeamMember, 'id'>) => void;
  selectedDepartment: Department | 'all';
}

export const TeamCapacityView: React.FC<TeamCapacityViewProps> = ({
  teamMembers,
  onUpdateMemberHours,
  onAddMember,
  selectedDepartment
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'optimal' | 'overloaded' | 'available'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingHours, setEditingHours] = useState<number>(40);

  // New member form state
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newDept, setNewDept] = useState<Department>('Ingeniería');
  const [newHours, setNewHours] = useState(35);
  const [newProjects, setNewProjects] = useState('');
  const [newSkills, setNewSkills] = useState('');

  const filteredMembers = teamMembers.filter((m) => {
    if (selectedDepartment !== 'all' && m.department !== selectedDepartment) {
      return false;
    }
    if (filterStatus !== 'all' && m.status !== filterStatus) {
      return false;
    }
    return true;
  });

  const totalAssignedHours = filteredMembers.reduce((acc, m) => acc + m.assignedHoursWeek, 0);
  const totalMaxHours = filteredMembers.reduce((acc, m) => acc + m.maxHoursWeek, 0);
  const overallTeamUtilization = totalMaxHours > 0 ? Math.round((totalAssignedHours / totalMaxHours) * 100) : 0;
  const overloadedCount = filteredMembers.filter(m => m.status === 'overloaded').length;

  const handleSaveHours = (id: string) => {
    onUpdateMemberHours(id, editingHours);
    setEditingMemberId(null);
  };

  const handleCreateMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newRole.trim()) return;

    const memberStatus = newHours > 40 ? 'overloaded' : newHours >= 32 ? 'optimal' : 'available';

    onAddMember({
      name: newName.trim(),
      role: newRole.trim(),
      department: newDept,
      avatar: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 1000)}?w=150&auto=format&fit=crop&q=80`,
      assignedHoursWeek: newHours,
      maxHoursWeek: 40,
      currentProjects: newProjects ? newProjects.split(',').map(p => p.trim()) : ['Proyecto General'],
      skills: newSkills ? newSkills.split(',').map(s => s.trim()) : ['General'],
      status: memberStatus
    });

    setNewName('');
    setNewRole('');
    setNewProjects('');
    setNewSkills('');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Capacidad & Carga de Trabajo del Equipo
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Planificación de horas, balanceo de esfuerzo y detección de sobreasignación de talento.
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer self-start sm:self-auto shadow-xs"
        >
          <UserPlus className="w-4 h-4" />
          <span>Añadir Miembro</span>
        </button>
      </div>

      {/* Summary KPI Cards for Team */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Horas Asignadas / Semana</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{totalAssignedHours}h</span>
            <span className="text-xs text-slate-500">de {totalMaxHours}h disponibles</span>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            Ocupación global: <strong className="text-slate-800">{overallTeamUtilization}%</strong>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Estado del Equipo</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-600">
              {filteredMembers.filter(m => m.status === 'optimal').length}
            </span>
            <span className="text-xs text-slate-500">con carga equilibrada</span>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {filteredMembers.filter(m => m.status === 'available').length} miembros con capacidad libre
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Sobrecarga & Riesgo</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${overloadedCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {overloadedCount}
            </span>
            <span className="text-xs text-slate-500">perfiles sobreasignados (&gt;40h)</span>
          </div>
          <div className="mt-2 text-xs text-amber-700">
            {overloadedCount > 0 ? 'Recomendado balancear proyectos' : 'No hay cuellos de botella'}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-white border border-slate-200 rounded-lg w-fit">
        <span className="text-xs font-semibold text-slate-500 px-2.5">Filtrar:</span>
        {[
          { id: 'all', label: 'Todos' },
          { id: 'optimal', label: 'Carga Óptima' },
          { id: 'overloaded', label: 'Sobreasignados' },
          { id: 'available', label: 'Con Disponibilidad' }
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setFilterStatus(item.id as any)}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              filterStatus === item.id 
                ? 'bg-slate-900 text-white font-semibold shadow-2xs' 
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Team Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMembers.map((member) => {
          const loadPercent = Math.round((member.assignedHoursWeek / member.maxHoursWeek) * 100);
          const isOverloaded = member.assignedHoursWeek > member.maxHoursWeek;
          const isEditing = editingMemberId === member.id;

          return (
            <div 
              key={member.id}
              className={`bg-white rounded-xl border p-5 shadow-2xs transition-all flex flex-col justify-between ${
                isOverloaded ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={member.avatar}
                      alt={member.name}
                      className="w-10 h-10 rounded-full object-cover border border-slate-200"
                    />
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{member.name}</h3>
                      <p className="text-xs text-slate-500">{member.role}</p>
                    </div>
                  </div>

                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    member.status === 'overloaded'
                      ? 'bg-rose-50 text-rose-700'
                      : member.status === 'optimal'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                    {member.status === 'overloaded' ? 'Sobrecarga' : member.status === 'optimal' ? 'Óptimo' : 'Disponible'}
                  </span>
                </div>

                {/* Capacity Hours Bar */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-600 font-medium">Asignación Semanal:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {member.assignedHoursWeek}h / {member.maxHoursWeek}h ({loadPercent}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ${
                        isOverloaded ? 'bg-rose-500' : loadPercent >= 80 ? 'bg-emerald-500' : 'bg-amber-400'
                      }`}
                      style={{ width: `${Math.min(loadPercent, 100)}%` }}
                    />
                  </div>
                </div>

                {/* Current Projects */}
                <div className="mt-3">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
                    Proyectos en curso:
                  </span>
                  <div className="space-y-1">
                    {member.currentProjects.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-xs text-slate-700">
                        <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Skills tags */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {member.skills.map((skill) => (
                    <span key={skill} className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>

              {/* Adjust hours action */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0"
                      max="70"
                      value={editingHours}
                      onChange={(e) => setEditingHours(Number(e.target.value))}
                      className="w-20 px-2 py-1 text-xs border border-slate-300 rounded font-mono"
                    />
                    <span className="text-xs text-slate-500">horas</span>
                    <button
                      onClick={() => handleSaveHours(member.id)}
                      className="px-2.5 py-1 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 cursor-pointer ml-auto"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => setEditingMemberId(null)}
                      className="px-2 py-1 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Departamento: {member.department}</span>
                    <button
                      onClick={() => {
                        setEditingMemberId(member.id);
                        setEditingHours(member.assignedHoursWeek);
                      }}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    >
                      Ajustar horas
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl max-w-md w-full p-6">
            <h2 className="text-base font-bold text-slate-900">Añadir Miembro al Equipo</h2>
            <p className="text-xs text-slate-500 mt-1">Registra un nuevo perfil para planificar asignación y esfuerzo.</p>

            <form onSubmit={handleCreateMember} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ej. Martín Vega"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Rol / Cargo</label>
                <input
                  type="text"
                  required
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  placeholder="Ej. Senior Frontend Developer"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Departamento</label>
                  <select
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value as Department)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="Ingeniería">Ingeniería</option>
                    <option value="Diseño">Diseño</option>
                    <option value="Sistemas">Sistemas</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Finanzas">Finanzas</option>
                    <option value="Operaciones">Operaciones</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Horas Asignadas / sem</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={newHours}
                    onChange={(e) => setNewHours(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Proyectos (separados por coma)</label>
                <input
                  type="text"
                  value={newProjects}
                  onChange={(e) => setNewProjects(e.target.value)}
                  placeholder="Ej. Migración Next.js, Portal Clientes"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Habilidades (separadas por coma)</label>
                <input
                  type="text"
                  value={newSkills}
                  onChange={(e) => setNewSkills(e.target.value)}
                  placeholder="Ej. React, TypeScript, GraphQL"
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Añadir Miembro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
