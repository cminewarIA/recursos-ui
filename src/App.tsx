/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { Header } from './components/Header';
import { OverviewView } from './components/OverviewView';
import { InventoryView } from './components/InventoryView';
import { TeamCapacityView } from './components/TeamCapacityView';
import { BookingsView } from './components/BookingsView';
import { CostOptimizationView } from './components/CostOptimizationView';
import { ResourceFormModal } from './components/ResourceFormModal';
import { ResourceDetailModal } from './components/ResourceDetailModal';
import { NewBookingModal } from './components/NewBookingModal';

import { 
  Resource, 
  TeamMember, 
  BookingRequest, 
  OptimizationAlert, 
  Department 
} from './types/resources';
import { 
  INITIAL_RESOURCES, 
  INITIAL_TEAM_MEMBERS, 
  INITIAL_BOOKINGS, 
  INITIAL_ALERTS 
} from './data/initialData';

export default function App() {
  // Navigation & Filtering State
  const [currentTab, setCurrentTab] = useState<NavTab>('overview');
  const [selectedDepartment, setSelectedDepartment] = useState<Department | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Core Data State (with localStorage persistence)
  const [resources, setResources] = useState<Resource[]>(() => {
    try {
      const saved = localStorage.getItem('recursos_data_v1');
      return saved ? JSON.parse(saved) : INITIAL_RESOURCES;
    } catch {
      return INITIAL_RESOURCES;
    }
  });

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>(() => {
    try {
      const saved = localStorage.getItem('recursos_team_v1');
      return saved ? JSON.parse(saved) : INITIAL_TEAM_MEMBERS;
    } catch {
      return INITIAL_TEAM_MEMBERS;
    }
  });

  const [bookings, setBookings] = useState<BookingRequest[]>(() => {
    try {
      const saved = localStorage.getItem('recursos_bookings_v1');
      return saved ? JSON.parse(saved) : INITIAL_BOOKINGS;
    } catch {
      return INITIAL_BOOKINGS;
    }
  });

  const [alerts, setAlerts] = useState<OptimizationAlert[]>(() => {
    try {
      const saved = localStorage.getItem('recursos_alerts_v1');
      return saved ? JSON.parse(saved) : INITIAL_ALERTS;
    } catch {
      return INITIAL_ALERTS;
    }
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('recursos_data_v1', JSON.stringify(resources));
  }, [resources]);

  useEffect(() => {
    localStorage.setItem('recursos_team_v1', JSON.stringify(teamMembers));
  }, [teamMembers]);

  useEffect(() => {
    localStorage.setItem('recursos_bookings_v1', JSON.stringify(bookings));
  }, [bookings]);

  useEffect(() => {
    localStorage.setItem('recursos_alerts_v1', JSON.stringify(alerts));
  }, [alerts]);

  // Modals state
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [detailResource, setDetailResource] = useState<Resource | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingPreselectedResource, setBookingPreselectedResource] = useState<Resource | null>(null);

  // Resource Operations
  const handleSaveResource = (payload: Omit<Resource, 'id'> | Resource) => {
    if ('id' in payload && payload.id) {
      // Update
      setResources(prev => prev.map(r => r.id === payload.id ? (payload as Resource) : r));
    } else {
      // Create new
      const newResource: Resource = {
        ...(payload as Omit<Resource, 'id'>),
        id: `res-${Date.now()}`
      };
      setResources(prev => [newResource, ...prev]);
    }
    setEditingResource(null);
  };

  const handleDeleteResource = (id: string) => {
    setResources(prev => prev.filter(r => r.id !== id));
    if (detailResource?.id === id) {
      setDetailResource(null);
    }
  };

  // Team Member Operations
  const handleUpdateMemberHours = (id: string, newHours: number) => {
    setTeamMembers(prev => prev.map(m => {
      if (m.id === id) {
        const status = newHours > m.maxHoursWeek ? 'overloaded' : newHours >= 32 ? 'optimal' : 'available';
        return { ...m, assignedHoursWeek: newHours, status };
      }
      return m;
    }));
  };

  const handleAddMember = (memberData: Omit<TeamMember, 'id'>) => {
    const newMember: TeamMember = {
      ...memberData,
      id: `tm-${Date.now()}`
    };
    setTeamMembers(prev => [...prev, newMember]);
  };

  // Booking Operations
  const handleApproveBooking = (id: string) => {
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'approved' } : b));
  };

  const handleRejectBooking = (id: string) => {
    setBookings(prev => prev.map(b => b.id === id ? { ...b, status: 'rejected' } : b));
  };

  const handleAddBooking = (newBookingData: Omit<BookingRequest, 'id' | 'createdAt'>) => {
    const newBooking: BookingRequest = {
      ...newBookingData,
      id: `bk-${Date.now()}`,
      createdAt: new Date().toISOString().split('T')[0]
    };
    setBookings(prev => [newBooking, ...prev]);
  };

  // Optimization Operations
  const handleDismissAlert = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const handleApplySavings = (alertId: string, savings: number) => {
    // Reduce cost on the corresponding resource if applicable
    const alertItem = alerts.find(a => a.id === alertId);
    if (alertItem) {
      setResources(prev => prev.map(r => {
        if (r.id === alertItem.resourceId) {
          return {
            ...r,
            costMonthly: Math.max(0, r.costMonthly - savings)
          };
        }
        return r;
      }));
    }
  };

  // Export handlers
  const handleExportCSV = () => {
    const headers = ['ID', 'Nombre', 'Categoria', 'SKU', 'Departamento', 'Estado', 'AsignadoA', 'Proyecto', 'CosteMensualEUR', 'CantidadTotal', 'CantidadDisponible', 'TasaOcupacionPct'];
    const rows = resources.map(r => [
      r.id,
      `"${r.name.replace(/"/g, '""')}"`,
      r.categoryLabel,
      r.skuOrCode,
      r.department,
      r.statusLabel,
      `"${(r.assignedTo || '').replace(/"/g, '""')}"`,
      `"${(r.project || '').replace(/"/g, '""')}"`,
      r.costMonthly,
      r.totalQuantity,
      r.availableQuantity,
      r.utilizationRate
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `recursos_dashboard_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJSON = () => {
    const dataToExport = {
      exportedAt: new Date().toISOString(),
      resources,
      teamMembers,
      bookings,
      alerts
    };
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(dataToExport, null, 2))}`;
    const link = document.createElement('a');
    link.setAttribute('href', jsonString);
    link.setAttribute('download', `recursos_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const pendingBookingsCount = bookings.filter(b => b.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row antialiased text-slate-900">
      {/* Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        pendingBookingsCount={pendingBookingsCount}
        alertsCount={alerts.length}
        selectedDepartment={selectedDepartment}
        onSelectDepartment={setSelectedDepartment}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          onOpenMobileMenu={() => setIsMobileOpen(true)}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onOpenNewResourceModal={() => {
            setEditingResource(null);
            setIsResourceModalOpen(true);
          }}
          onOpenBookingModal={() => {
            setBookingPreselectedResource(null);
            setIsBookingModalOpen(true);
          }}
          alerts={alerts}
          selectedDepartment={selectedDepartment}
          onExportCSV={handleExportCSV}
          onExportJSON={handleExportJSON}
        />

        {/* View Router */}
        <main className="flex-1 p-4 sm:p-6 md:p-8 max-w-7xl w-full mx-auto">
          {currentTab === 'overview' && (
            <OverviewView
              resources={resources}
              bookings={bookings}
              alerts={alerts}
              onNavigateTab={setCurrentTab}
              onApproveBooking={handleApproveBooking}
              onRejectBooking={handleRejectBooking}
              onSelectResource={(res) => setDetailResource(res)}
              selectedDepartment={selectedDepartment}
            />
          )}

          {currentTab === 'inventory' && (
            <InventoryView
              resources={resources}
              onSelectResource={(res) => setDetailResource(res)}
              onEditResource={(res) => {
                setEditingResource(res);
                setIsResourceModalOpen(true);
              }}
              onDeleteResource={handleDeleteResource}
              onOpenNewResourceModal={() => {
                setEditingResource(null);
                setIsResourceModalOpen(true);
              }}
              searchQuery={searchQuery}
              selectedDepartment={selectedDepartment}
            />
          )}

          {currentTab === 'capacity' && (
            <TeamCapacityView
              teamMembers={teamMembers}
              onUpdateMemberHours={handleUpdateMemberHours}
              onAddMember={handleAddMember}
              selectedDepartment={selectedDepartment}
            />
          )}

          {currentTab === 'bookings' && (
            <BookingsView
              bookings={bookings}
              onApproveBooking={handleApproveBooking}
              onRejectBooking={handleRejectBooking}
              onOpenBookingModal={() => {
                setBookingPreselectedResource(null);
                setIsBookingModalOpen(true);
              }}
              selectedDepartment={selectedDepartment}
            />
          )}

          {currentTab === 'optimization' && (
            <CostOptimizationView
              resources={resources}
              alerts={alerts}
              onDismissAlert={handleDismissAlert}
              onApplySavings={handleApplySavings}
              selectedDepartment={selectedDepartment}
            />
          )}
        </main>
      </div>

      {/* Modal: Add / Edit Resource */}
      <ResourceFormModal
        isOpen={isResourceModalOpen}
        onClose={() => {
          setIsResourceModalOpen(false);
          setEditingResource(null);
        }}
        onSave={handleSaveResource}
        initialData={editingResource}
      />

      {/* Modal: Resource Details */}
      <ResourceDetailModal
        resource={detailResource}
        onClose={() => setDetailResource(null)}
        onEdit={(res) => {
          setDetailResource(null);
          setEditingResource(res);
          setIsResourceModalOpen(true);
        }}
        onDelete={handleDeleteResource}
        onToggleStatus={(res) => {
          const nextStatus = res.status === 'available' ? 'allocated' : 'available';
          handleSaveResource({
            ...res,
            status: nextStatus,
            statusLabel: nextStatus === 'available' ? 'Disponible' : 'Asignado'
          });
          setDetailResource(null);
        }}
        onBookResource={(res) => {
          setBookingPreselectedResource(res);
          setIsBookingModalOpen(true);
        }}
      />

      {/* Modal: New Booking */}
      <NewBookingModal
        isOpen={isBookingModalOpen}
        onClose={() => {
          setIsBookingModalOpen(false);
          setBookingPreselectedResource(null);
        }}
        resources={resources}
        initialResource={bookingPreselectedResource}
        onAddBooking={handleAddBooking}
      />
    </div>
  );
}
