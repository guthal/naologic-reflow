export interface BaseDoc<TDocType extends string, TData> {
  docId: string;
  docType: TDocType;
  data: TData;
}

export type WorkOrderDoc = BaseDoc<
  "workOrder",
  {
    workOrderNumber: string;
    manufacturingOrderId: string;
    workCenterId: string;
    startDate: string;
    endDate: string;
    durationMinutes: number;
    setupTimeMinutes?: number;
    isMaintenance: boolean;
    dependsOnWorkOrderIds: string[];
  }
>;

export type WorkCenterDoc = BaseDoc<
  "workCenter",
  {
    name: string;
    shifts: Array<{
      dayOfWeek: number;
      startHour: number;
      endHour: number;
    }>;
    maintenanceWindows: Array<{
      startDate: string;
      endDate: string;
      reason?: string;
    }>;
  }
>;

export type ManufacturingOrderDoc = BaseDoc<
  "manufacturingOrder",
  {
    manufacturingOrderNumber: string;
    itemId: string;
    quantity: number;
    dueDate: string;
  }
>;

export interface ReflowInput {
  workOrders: WorkOrderDoc[];
  workCenters: WorkCenterDoc[];
  manufacturingOrders?: ManufacturingOrderDoc[];
}

export interface WorkOrderChange {
  workOrderId: string;
  workOrderNumber: string;
  oldStartDate: string;
  newStartDate: string;
  oldEndDate: string;
  newEndDate: string;
  startShiftMinutes: number;
  endShiftMinutes: number;
  reason: string;
}

export interface ReflowResult {
  updatedWorkOrders: WorkOrderDoc[];
  changes: WorkOrderChange[];
  explanation: string;
}
