import React, { useState } from 'react';
import { 
  TrendingDown, 
  PiggyBank, 
  Zap, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight, 
  DollarSign,
  Layers,
  Sparkles
} from 'lucide-react';
import { OptimizationAlert, Resource, Department } from '../types/resources';

interface CostOptimizationViewProps {
  resources: Resource[];
  alerts: OptimizationAlert[];
  onDismissAlert: (id: string) => void;
  onApplySavings: (alertId: string, savings: number) => void;
  selectedDepartment: Department | 'all';
}

export const CostOptimizationView: React.FC<CostOptimizationViewProps> = ({
  resources,
  alerts,
  onDismissAlert,
  onApplySavings,
  selectedDepartment
}) => {
  const [appliedAlertIds, setAppliedAlertIds] = useState<string[]>([]);

  const filteredResources = selectedDepartment === 'all' 
    ? resources 
    : resources.filter(r => r.department === selectedDepartment);

  const totalMonthlySpend = filteredResources.reduce((acc, r) => acc + r.costMonthly, 0);
  const potentialMonthlySavings = alerts.reduce((acc, a) => acc + (a.potentialSavingsMonthly || 0), 0);
  const projectedAnnualSavings = potentialMonthlySavings * 12;

  // Department cost breakdown
  const deptCosts: { [key in Department]?: number } = {};
  filteredResources.forEach((r) => {
    deptCosts[r.department] = (deptCosts[r.department] || 0) + r.costMonthly;
  });

  const handleOptimize = (alt: OptimizationAlert) => {
    if (alt.potentialSavingsMonthly) {
      onApplySavings(alt.id, alt.potentialSavingsMonthly);
    }
    setAppliedAlertIds(prev => [...prev, alt.id]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          Análisis de Costes & Optimización de Recursos
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Detección algorítmica de licencias infrautilizadas, servidores sobredimensionados y oportunidades de reducción de costes.
        </p>
      </div>

      {/* Financial KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Gasto Mensual Actual</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              €{totalMonthlySpend.toLocaleString('es-ES')}
            </span>
            <span className="text-xs text-slate-500">/ mes</span>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            Proyección anual: <strong>€{(totalMonthlySpend * 12).toLocaleString('es-ES')}</strong>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-emerald-200 bg-emerald-50/30 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 uppercase">Ahorro Mensual Detectado</span>
            <PiggyBank className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-emerald-700">
              €{potentialMonthlySavings.toLocaleString('es-ES')}
            </span>
            <span className="text-xs text-emerald-700">/ mes</span>
          </div>
          <div className="mt-2 text-xs text-emerald-800 font-medium">
            Hasta €{projectedAnnualSavings.toLocaleString('es-ES')} al año optimizando activos
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-500 uppercase">Oportunidades Abiertas</span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-indigo-600">{alerts.length}</span>
            <span className="text-xs text-slate-500">recomendaciones activas</span>
          </div>
          <div className="mt-2 text-xs text-slate-600">
            {appliedAlertIds.length} optimizaciones ejecutadas en esta sesión
          </div>
        </div>
      </div>

      {/* Department Expense Distribution */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
        <h2 className="text-sm font-bold text-slate-900 mb-1">Gasto por Departamento</h2>
        <p className="text-xs text-slate-500 mb-4">Desglose porcentual del presupuesto en licencias y hardware</p>

        <div className="space-y-3">
          {Object.entries(deptCosts).map(([dept, cost]) => {
            const percentage = totalMonthlySpend > 0 ? Math.round(((cost || 0) / totalMonthlySpend) * 100) : 0;
            return (
              <div key={dept}>
                <div className="flex justify-between text-xs font-medium text-slate-700 mb-1">
                  <span>{dept}</span>
                  <span className="font-mono text-slate-900">€{(cost || 0).toLocaleString('es-ES')} ({percentage}%)</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div 
                    className="bg-indigo-600 h-2 rounded-full transition-all duration-500" 
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Audit & Optimization Actions */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-bold text-slate-900">Recomendaciones de Optimización Directa</h2>
          </div>
          <span className="text-xs text-slate-500">Auditoría automática</span>
        </div>

        <div className="divide-y divide-slate-100">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              <p className="font-semibold text-slate-800">¡Todos los recursos están optimizados al máximo!</p>
              <p>No se han detectado gastos superfluos ni licencias inactivas.</p>
            </div>
          ) : (
            alerts.map((alt) => {
              const isApplied = appliedAlertIds.includes(alt.id);

              return (
                <div 
                  key={alt.id}
                  className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">{alt.title}</span>
                      <span className="text-[10px] uppercase font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {alt.category}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                      {alt.description}
                    </p>

                    <div className="flex items-center gap-2 text-xs text-slate-500 pt-1">
                      <span>Recurso afectado: <strong>{alt.resourceName}</strong></span>
                      {alt.potentialSavingsMonthly ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 font-semibold font-mono">
                            Ahorro estimado: €{alt.potentialSavingsMonthly}/mes
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    {isApplied ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg">
                        <CheckCircle2 className="w-4 h-4" /> Optimizado
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => onDismissAlert(alt.id)}
                          className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Ignorar
                        </button>
                        <button
                          onClick={() => handleOptimize(alt)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                          <span>Aplicar Ahorro</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
