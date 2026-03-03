import type { ManufacturingOrderDoc, ReflowInput, WorkCenterDoc, WorkOrderDoc } from "../reflow/types.js";

const WORK_CENTER_A: WorkCenterDoc = {
  docId: "wc-extrusion-a",
  docType: "workCenter",
  data: {
    name: "Extrusion Line A",
    shifts: [
      { dayOfWeek: 1, startHour: 8, endHour: 17 },
      { dayOfWeek: 2, startHour: 8, endHour: 17 },
      { dayOfWeek: 3, startHour: 8, endHour: 17 },
      { dayOfWeek: 4, startHour: 8, endHour: 17 },
      { dayOfWeek: 5, startHour: 8, endHour: 17 },
    ],
    maintenanceWindows: [],
  },
};

const WORK_CENTER_B: WorkCenterDoc = {
  docId: "wc-extrusion-b",
  docType: "workCenter",
  data: {
    name: "Extrusion Line B",
    shifts: [
      { dayOfWeek: 1, startHour: 6, endHour: 14 },
      { dayOfWeek: 2, startHour: 6, endHour: 14 },
      { dayOfWeek: 3, startHour: 6, endHour: 14 },
      { dayOfWeek: 4, startHour: 6, endHour: 14 },
      { dayOfWeek: 5, startHour: 6, endHour: 14 },
    ],
    maintenanceWindows: [
      {
        startDate: "2026-03-03T09:00:00Z",
        endDate: "2026-03-03T11:00:00Z",
        reason: "Planned line calibration",
      },
    ],
  },
};

const WORK_CENTER_C: WorkCenterDoc = {
  docId: "wc-extrusion-c",
  docType: "workCenter",
  data: {
    name: "Extrusion Line C",
    shifts: [
      { dayOfWeek: 1, startHour: 8, endHour: 17 },
      { dayOfWeek: 2, startHour: 8, endHour: 17 },
      { dayOfWeek: 3, startHour: 8, endHour: 17 },
      { dayOfWeek: 4, startHour: 8, endHour: 17 },
      { dayOfWeek: 5, startHour: 8, endHour: 17 },
    ],
    maintenanceWindows: [],
  },
};

function wo(
  id: string,
  number: string,
  workCenterId: string,
  startDate: string,
  endDate: string,
  durationMinutes: number,
  dependsOnWorkOrderIds: string[] = [],
  isMaintenance = false,
): WorkOrderDoc {
  return {
    docId: id,
    docType: "workOrder",
    data: {
      workOrderNumber: number,
      manufacturingOrderId: `mo-${number}`,
      workCenterId,
      startDate,
      endDate,
      durationMinutes,
      dependsOnWorkOrderIds,
      isMaintenance,
    },
  };
}

export function delayCascadeScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_A],
    workOrders: [
      wo("wo-1", "WO-1001", WORK_CENTER_A.docId, "2026-03-02T08:00:00Z", "2026-03-02T12:00:00Z", 360),
      wo(
        "wo-2",
        "WO-1002",
        WORK_CENTER_A.docId,
        "2026-03-02T12:00:00Z",
        "2026-03-02T15:00:00Z",
        240,
        ["wo-1"],
      ),
      wo(
        "wo-3",
        "WO-1003",
        WORK_CENTER_A.docId,
        "2026-03-02T15:00:00Z",
        "2026-03-02T17:00:00Z",
        180,
        ["wo-2"],
      ),
    ],
  };
}

export function shiftBoundaryScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_A],
    workOrders: [
      wo("wo-4", "WO-2001", WORK_CENTER_A.docId, "2026-03-02T16:00:00Z", "2026-03-02T18:00:00Z", 120),
      wo(
        "wo-5",
        "WO-2002",
        WORK_CENTER_A.docId,
        "2026-03-02T17:00:00Z",
        "2026-03-02T19:00:00Z",
        120,
        ["wo-4"],
      ),
    ],
  };
}

export function maintenanceConflictScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_B],
    workOrders: [
      wo("wo-6", "WO-3001", WORK_CENTER_B.docId, "2026-03-03T06:00:00Z", "2026-03-03T10:00:00Z", 300),
      wo(
        "wo-7",
        "WO-3002",
        WORK_CENTER_B.docId,
        "2026-03-03T10:00:00Z",
        "2026-03-03T13:00:00Z",
        180,
        ["wo-6"],
      ),
      wo(
        "wo-8",
        "WO-MAINT-B1",
        WORK_CENTER_B.docId,
        "2026-03-04T08:00:00Z",
        "2026-03-04T10:00:00Z",
        120,
        [],
        true,
      ),
    ],
  };
}

export function fanOutSameWorkCenterScenario(): ReflowInput {
  const workOrders: WorkOrderDoc[] = [
    wo("wo-9", "WO-4001", WORK_CENTER_A.docId, "2026-03-02T08:00:00Z", "2026-03-02T10:00:00Z", 120),
    wo(
      "wo-10",
      "WO-4002",
      WORK_CENTER_A.docId,
      "2026-03-02T10:00:00Z",
      "2026-03-02T12:00:00Z",
      120,
      ["wo-9"],
    ),
    wo(
      "wo-11",
      "WO-4003",
      WORK_CENTER_A.docId,
      "2026-03-02T10:00:00Z",
      "2026-03-02T11:00:00Z",
      60,
      ["wo-9"],
    ),
  ];

  const manufacturingOrders: ManufacturingOrderDoc[] = [
    {
      docId: "mo-WO-4001",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-WO-4001",
        itemId: "SKU-4001",
        quantity: 1,
        dueDate: "2026-03-05T00:00:00Z",
      },
    },
    {
      docId: "mo-WO-4002",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-WO-4002",
        itemId: "SKU-4002",
        quantity: 1,
        dueDate: "2026-03-02T12:30:00Z",
      },
    },
    {
      docId: "mo-WO-4003",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-WO-4003",
        itemId: "SKU-4003",
        quantity: 1,
        dueDate: "2026-03-02T18:00:00Z",
      },
    },
  ];

  return {
    workCenters: [WORK_CENTER_A],
    workOrders,
    manufacturingOrders,
  };
}

export function fanInManyParentsScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_A],
    workOrders: [
      wo("wo-12", "WO-5001", WORK_CENTER_A.docId, "2026-03-03T08:00:00Z", "2026-03-03T09:00:00Z", 60),
      wo("wo-13", "WO-5002", WORK_CENTER_A.docId, "2026-03-03T09:00:00Z", "2026-03-03T11:00:00Z", 120),
      wo("wo-14", "WO-5003", WORK_CENTER_A.docId, "2026-03-03T11:00:00Z", "2026-03-03T14:00:00Z", 180),
      wo("wo-15", "WO-5004", WORK_CENTER_A.docId, "2026-03-03T14:00:00Z", "2026-03-03T16:00:00Z", 120),
      wo(
        "wo-16",
        "WO-5005",
        WORK_CENTER_A.docId,
        "2026-03-03T08:30:00Z",
        "2026-03-03T09:30:00Z",
        60,
        ["wo-12", "wo-13", "wo-14", "wo-15"],
      ),
    ],
  };
}

export function diamondPatternScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_A],
    workOrders: [
      wo("wo-17", "WO-6001", WORK_CENTER_A.docId, "2026-03-04T08:00:00Z", "2026-03-04T10:00:00Z", 120),
      wo(
        "wo-18",
        "WO-6002",
        WORK_CENTER_A.docId,
        "2026-03-04T10:00:00Z",
        "2026-03-04T12:00:00Z",
        120,
        ["wo-17"],
      ),
      wo(
        "wo-19",
        "WO-6003",
        WORK_CENTER_A.docId,
        "2026-03-04T10:00:00Z",
        "2026-03-04T11:00:00Z",
        60,
        ["wo-17"],
      ),
      wo(
        "wo-20",
        "WO-6004",
        WORK_CENTER_A.docId,
        "2026-03-04T09:00:00Z",
        "2026-03-04T10:00:00Z",
        60,
        ["wo-18", "wo-19"],
      ),
    ],
  };
}

export function criticalPathPriorityScenario(): ReflowInput {
  return {
    workCenters: [WORK_CENTER_A, WORK_CENTER_C],
    workOrders: [
      wo("wo-21", "WO-7001", WORK_CENTER_A.docId, "2026-03-05T08:00:00Z", "2026-03-05T10:00:00Z", 120),
      wo("wo-22", "WO-7002", WORK_CENTER_A.docId, "2026-03-05T08:00:00Z", "2026-03-05T10:00:00Z", 120),
      wo(
        "wo-23",
        "WO-7003",
        WORK_CENTER_A.docId,
        "2026-03-05T08:00:00Z",
        "2026-03-05T13:00:00Z",
        300,
        ["wo-21"],
      ),
      wo(
        "wo-24",
        "WO-7004",
        WORK_CENTER_C.docId,
        "2026-03-05T08:00:00Z",
        "2026-03-05T08:30:00Z",
        30,
        ["wo-22"],
      ),
    ],
  };
}
