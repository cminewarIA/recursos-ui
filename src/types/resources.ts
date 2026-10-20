export type ResourceCategory = 'hardware' | 'software' | 'human' | 'cloud' | 'facility';

export type ResourceStatus = 'available' | 'allocated' | 'maintenance' | 'reserved';

export type Department = 'Ingeniería' | 'Diseño' | 'Marketing' | 'Operaciones' | 'Finanzas' | 'Sistemas';

export interface Resource {
  id: string;
  name: string;
  category: ResourceCategory;
  categoryLabel: string;
  skuOrCode: string;
  department: Department;
  status: ResourceStatus;
  statusLabel: string;
  assignedTo?: string;
  assignedRole?: string;
  project?: string;
  costMonthly: number;
  totalQuantity: number;
  availableQuantity: number;
  location?: string;
  specifications: string;
  purchaseDate: string;
  maintenanceDate?: string;
  utilizationRate: number; // 0 - 100%
  tags: string[];
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  department: Department;
  avatar: string;
  assignedHoursWeek: number;
  maxHoursWeek: number;
  currentProjects: string[];
  skills: string[];
  status: 'optimal' | 'overloaded' | 'available';
}

export interface BookingRequest {
  id: string;
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  requestedBy: string;
  department: Department;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export interface OptimizationAlert {
  id: string;
  resourceId: string;
  resourceName: string;
  category: ResourceCategory;
  type: 'unused_license' | 'idle_cloud' | 'overcapacity' | 'maintenance_due';
  title: string;
  description: string;
  potentialSavingsMonthly?: number;
  severity: 'low' | 'medium' | 'high';
}
