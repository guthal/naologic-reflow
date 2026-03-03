const WORK_CENTER_A = {
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
const WORK_CENTER_B = {
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
function wo(id, number, workCenterId, startDate, endDate, durationMinutes, dependsOnWorkOrderIds = [], isMaintenance = false) {
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
export function delayCascadeScenario() {
    return {
        workCenters: [WORK_CENTER_A],
        workOrders: [
            wo("wo-1", "WO-1001", WORK_CENTER_A.docId, "2026-03-02T08:00:00Z", "2026-03-02T12:00:00Z", 360),
            wo("wo-2", "WO-1002", WORK_CENTER_A.docId, "2026-03-02T12:00:00Z", "2026-03-02T15:00:00Z", 240, ["wo-1"]),
            wo("wo-3", "WO-1003", WORK_CENTER_A.docId, "2026-03-02T15:00:00Z", "2026-03-02T17:00:00Z", 180, ["wo-2"]),
        ],
    };
}
export function shiftBoundaryScenario() {
    return {
        workCenters: [WORK_CENTER_A],
        workOrders: [
            wo("wo-4", "WO-2001", WORK_CENTER_A.docId, "2026-03-02T16:00:00Z", "2026-03-02T18:00:00Z", 120),
            wo("wo-5", "WO-2002", WORK_CENTER_A.docId, "2026-03-02T17:00:00Z", "2026-03-02T19:00:00Z", 120, ["wo-4"]),
        ],
    };
}
export function maintenanceConflictScenario() {
    return {
        workCenters: [WORK_CENTER_B],
        workOrders: [
            wo("wo-6", "WO-3001", WORK_CENTER_B.docId, "2026-03-03T06:00:00Z", "2026-03-03T10:00:00Z", 300),
            wo("wo-7", "WO-3002", WORK_CENTER_B.docId, "2026-03-03T10:00:00Z", "2026-03-03T13:00:00Z", 180, ["wo-6"]),
            wo("wo-8", "WO-MAINT-B1", WORK_CENTER_B.docId, "2026-03-04T08:00:00Z", "2026-03-04T10:00:00Z", 120, [], true),
        ],
    };
}
