import test from "node:test";
import assert from "node:assert/strict";
import { ReflowService } from "./reflow.service.js";
import { assertDependenciesSatisfied, assertNoOverlapsByWorkCenter } from "./constraint-checker.js";
import {
  delayCascadeScenario,
  diamondPatternScenario,
  maintenanceConflictScenario,
  shiftBoundaryScenario,
} from "../sample-data/scenarios.js";
import type {
  ManufacturingOrderDoc,
  ReflowInput,
  WorkCenterDoc,
  WorkOrderDoc,
} from "./types.js";

const service = new ReflowService();

function mapByOrderNumber(workOrders: WorkOrderDoc[]): Map<string, WorkOrderDoc> {
  return new Map(workOrders.map((wo) => [wo.data.workOrderNumber, wo]));
}

function findById(workOrders: WorkOrderDoc[], id: string): WorkOrderDoc {
  const order = workOrders.find((wo) => wo.docId === id);
  assert.ok(order, `Expected work order ${id} to exist`);
  return order;
}

test("delay cascade scenario shifts downstream dependent orders", () => {
  const result = service.reflow(delayCascadeScenario());
  const byNumber = mapByOrderNumber(result.updatedWorkOrders);

  assert.equal(byNumber.get("WO-1001")?.data.startDate, "2026-03-02T08:00:00Z");
  assert.equal(byNumber.get("WO-1001")?.data.endDate, "2026-03-02T14:00:00Z");
  assert.equal(byNumber.get("WO-1002")?.data.startDate, "2026-03-02T14:00:00Z");
  assert.equal(byNumber.get("WO-1002")?.data.endDate, "2026-03-03T09:00:00Z");
  assert.equal(byNumber.get("WO-1003")?.data.startDate, "2026-03-03T09:00:00Z");
  assert.equal(byNumber.get("WO-1003")?.data.endDate, "2026-03-03T12:00:00Z");

  assert.equal(result.changes.length, 3);
  const wo1002Change = result.changes.find((change) => change.workOrderNumber === "WO-1002");
  assert.ok(wo1002Change, "Expected change entry for WO-1002");
  assert.match(wo1002Change.reason, /dependency wait/i);
  assert.doesNotMatch(
    wo1002Change.reason,
    /Dependency, shift, maintenance, or work-center conflict resolution/i,
  );
  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, delayCascadeScenario().workCenters);
});

test("shift boundary scenario pauses and resumes in next shift", () => {
  const result = service.reflow(shiftBoundaryScenario());
  const byNumber = mapByOrderNumber(result.updatedWorkOrders);

  assert.equal(byNumber.get("WO-2001")?.data.startDate, "2026-03-02T16:00:00Z");
  assert.equal(byNumber.get("WO-2001")?.data.endDate, "2026-03-03T09:00:00Z");
  assert.equal(byNumber.get("WO-2002")?.data.startDate, "2026-03-03T09:00:00Z");
  assert.equal(byNumber.get("WO-2002")?.data.endDate, "2026-03-03T11:00:00Z");

  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, shiftBoundaryScenario().workCenters);
});

test("maintenance conflict scenario blocks working time and keeps fixed maintenance immutable", () => {
  const input = maintenanceConflictScenario();
  const originalMaintenance = findById(input.workOrders, "wo-8");
  const result = service.reflow(input);
  const byNumber = mapByOrderNumber(result.updatedWorkOrders);

  assert.equal(byNumber.get("WO-3001")?.data.endDate, "2026-03-03T13:00:00Z");
  assert.equal(byNumber.get("WO-3002")?.data.startDate, "2026-03-03T13:00:00Z");
  assert.equal(byNumber.get("WO-3002")?.data.endDate, "2026-03-04T08:00:00Z");

  const updatedMaintenance = findById(result.updatedWorkOrders, "wo-8");
  assert.equal(updatedMaintenance.data.startDate, originalMaintenance.data.startDate);
  assert.equal(updatedMaintenance.data.endDate, originalMaintenance.data.endDate);

  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, input.workCenters);
});

test("orders with multiple parents start after latest dependency completion", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-1",
    docType: "workCenter",
    data: {
      name: "Line 1",
      shifts: [
        { dayOfWeek: 1, startHour: 8, endHour: 17 },
        { dayOfWeek: 2, startHour: 8, endHour: 17 },
      ],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-parent-a",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-A",
        manufacturingOrderId: "MO-A",
        workCenterId: "wc-1",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-parent-b",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-B",
        manufacturingOrderId: "MO-B",
        workCenterId: "wc-1",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T13:00:00Z",
        durationMinutes: 180,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-child",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD",
        manufacturingOrderId: "MO-C",
        workCenterId: "wc-1",
        startDate: "2026-03-02T09:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent-a", "wo-parent-b"],
      },
    },
  ];

  const input: ReflowInput = { workCenters: [workCenter], workOrders };
  const result = service.reflow(input);
  const child = findById(result.updatedWorkOrders, "wo-child");

  assert.equal(child.data.startDate, "2026-03-02T13:00:00Z");
  assert.equal(child.data.endDate, "2026-03-02T14:00:00Z");
});

test("fan-in with many parents schedules child after the latest parent completion", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-fanin",
    docType: "workCenter",
    data: {
      name: "Line Fan-in",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-parent-a",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-A",
        manufacturingOrderId: "MO-FA",
        workCenterId: "wc-fanin",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T09:00:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-parent-b",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-B",
        manufacturingOrderId: "MO-FB",
        workCenterId: "wc-fanin",
        startDate: "2026-03-02T09:00:00Z",
        endDate: "2026-03-02T11:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-parent-c",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-C",
        manufacturingOrderId: "MO-FC",
        workCenterId: "wc-fanin",
        startDate: "2026-03-02T11:00:00Z",
        endDate: "2026-03-02T14:00:00Z",
        durationMinutes: 180,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-parent-d",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT-D",
        manufacturingOrderId: "MO-FD",
        workCenterId: "wc-fanin",
        startDate: "2026-03-02T14:00:00Z",
        endDate: "2026-03-02T16:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-child-fanin",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD-FANIN",
        manufacturingOrderId: "MO-CHILD",
        workCenterId: "wc-fanin",
        startDate: "2026-03-02T08:30:00Z",
        endDate: "2026-03-02T09:30:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent-a", "wo-parent-b", "wo-parent-c", "wo-parent-d"],
      },
    },
  ];

  const input: ReflowInput = { workCenters: [workCenter], workOrders };
  const result = service.reflow(input);
  const child = findById(result.updatedWorkOrders, "wo-child-fanin");

  assert.equal(child.data.startDate, "2026-03-02T16:00:00Z");
  assert.equal(child.data.endDate, "2026-03-02T17:00:00Z");
  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, [workCenter]);
});

test("diamond dependency pattern schedules downstream after both branches complete", () => {
  const input = diamondPatternScenario();
  const result = service.reflow(input);

  const b = findById(result.updatedWorkOrders, "wo-17");
  const a = findById(result.updatedWorkOrders, "wo-18");
  const c = findById(result.updatedWorkOrders, "wo-19");
  const d = findById(result.updatedWorkOrders, "wo-20");

  assert.equal(b.data.startDate, "2026-03-04T08:00:00Z");
  assert.equal(b.data.endDate, "2026-03-04T10:00:00Z");
  assert.equal(c.data.startDate, "2026-03-04T10:00:00Z");
  assert.equal(c.data.endDate, "2026-03-04T11:00:00Z");
  assert.equal(a.data.startDate, "2026-03-04T11:00:00Z");
  assert.equal(a.data.endDate, "2026-03-04T13:00:00Z");
  assert.equal(d.data.startDate, "2026-03-04T13:00:00Z");
  assert.equal(d.data.endDate, "2026-03-04T14:00:00Z");

  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, input.workCenters);
});

test("shared work-center parents prioritize cross-center utilization and lower branch workload", () => {
  const wc1: WorkCenterDoc = {
    docId: "wc-opt-1",
    docType: "workCenter",
    data: {
      name: "Optimizer WC1",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const wc2: WorkCenterDoc = {
    docId: "wc-opt-2",
    docType: "workCenter",
    data: {
      name: "Optimizer WC2",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-a",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-A",
        manufacturingOrderId: "MO-A",
        workCenterId: "wc-opt-1",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-b",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-B",
        manufacturingOrderId: "MO-B",
        workCenterId: "wc-opt-1",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-c",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-C",
        manufacturingOrderId: "MO-C",
        workCenterId: "wc-opt-1",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T13:00:00Z",
        durationMinutes: 300,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-a"],
      },
    },
    {
      docId: "wo-d",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-D",
        manufacturingOrderId: "MO-D",
        workCenterId: "wc-opt-2",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T08:30:00Z",
        durationMinutes: 30,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-b"],
      },
    },
  ];

  const input: ReflowInput = { workCenters: [wc1, wc2], workOrders };
  const result = service.reflow(input);

  const a = findById(result.updatedWorkOrders, "wo-a");
  const b = findById(result.updatedWorkOrders, "wo-b");
  const c = findById(result.updatedWorkOrders, "wo-c");
  const d = findById(result.updatedWorkOrders, "wo-d");

  assert.equal(b.data.startDate, "2026-03-02T08:00:00Z");
  assert.equal(b.data.endDate, "2026-03-02T10:00:00Z");
  assert.equal(a.data.startDate, "2026-03-02T10:00:00Z");
  assert.equal(a.data.endDate, "2026-03-02T12:00:00Z");
  assert.equal(c.data.startDate, "2026-03-02T12:00:00Z");
  assert.equal(c.data.endDate, "2026-03-02T17:00:00Z");
  assert.equal(d.data.startDate, "2026-03-02T10:00:00Z");
  assert.equal(d.data.endDate, "2026-03-02T10:30:00Z");

  assertDependenciesSatisfied(result.updatedWorkOrders);
  assertNoOverlapsByWorkCenter(result.updatedWorkOrders, [wc1, wc2]);
});

test("fan-out children on same work center use due-date slack as first tie-breaker", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-fanout-slack",
    docType: "workCenter",
    data: {
      name: "Line Fanout Slack",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-parent",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT",
        manufacturingOrderId: "MO-PARENT",
        workCenterId: "wc-fanout-slack",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-child-urgent",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD-URGENT",
        manufacturingOrderId: "MO-URGENT",
        workCenterId: "wc-fanout-slack",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T12:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
    {
      docId: "wo-child-relaxed",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD-RELAXED",
        manufacturingOrderId: "MO-RELAXED",
        workCenterId: "wc-fanout-slack",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T12:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
  ];

  const manufacturingOrders: ManufacturingOrderDoc[] = [
    {
      docId: "MO-PARENT",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-PARENT",
        itemId: "SKU-PARENT",
        quantity: 1,
        dueDate: "2026-03-05T00:00:00Z",
      },
    },
    {
      docId: "MO-URGENT",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-URGENT",
        itemId: "SKU-A",
        quantity: 1,
        dueDate: "2026-03-02T12:30:00Z",
      },
    },
    {
      docId: "MO-RELAXED",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-RELAXED",
        itemId: "SKU-B",
        quantity: 1,
        dueDate: "2026-03-02T18:00:00Z",
      },
    },
  ];

  const result = service.reflow({ workCenters: [workCenter], workOrders, manufacturingOrders });
  const urgent = findById(result.updatedWorkOrders, "wo-child-urgent");
  const relaxed = findById(result.updatedWorkOrders, "wo-child-relaxed");

  assert.equal(urgent.data.startDate, "2026-03-02T10:00:00Z");
  assert.equal(relaxed.data.startDate, "2026-03-02T12:00:00Z");
});

test("when due-date slack ties, shorter duration is scheduled first", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-fanout-duration",
    docType: "workCenter",
    data: {
      name: "Line Fanout Duration",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-parent",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT",
        manufacturingOrderId: "MO-PARENT",
        workCenterId: "wc-fanout-duration",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-child-short",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD-SHORT",
        manufacturingOrderId: "MO-SHORT",
        workCenterId: "wc-fanout-duration",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T12:00:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
    {
      docId: "wo-child-long",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-CHILD-LONG",
        manufacturingOrderId: "MO-LONG",
        workCenterId: "wc-fanout-duration",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T12:00:00Z",
        durationMinutes: 180,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
  ];

  const manufacturingOrders: ManufacturingOrderDoc[] = [
    {
      docId: "MO-PARENT",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-PARENT",
        itemId: "SKU-PARENT",
        quantity: 1,
        dueDate: "2026-03-05T00:00:00Z",
      },
    },
    {
      docId: "MO-SHORT",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-SHORT",
        itemId: "SKU-SHORT",
        quantity: 1,
        dueDate: "2026-03-03T00:00:00Z",
      },
    },
    {
      docId: "MO-LONG",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-LONG",
        itemId: "SKU-LONG",
        quantity: 1,
        dueDate: "2026-03-03T00:00:00Z",
      },
    },
  ];

  const result = service.reflow({ workCenters: [workCenter], workOrders, manufacturingOrders });
  const short = findById(result.updatedWorkOrders, "wo-child-short");
  const long = findById(result.updatedWorkOrders, "wo-child-long");

  assert.equal(short.data.startDate, "2026-03-02T10:00:00Z");
  assert.equal(long.data.startDate, "2026-03-02T11:00:00Z");
});

test("when start, slack, and duration tie, sorting is deterministic by workOrderNumber then docId", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-fanout-deterministic",
    docType: "workCenter",
    data: {
      name: "Line Fanout Deterministic",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 20 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-parent",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-PARENT",
        manufacturingOrderId: "MO-PARENT",
        workCenterId: "wc-fanout-deterministic",
        startDate: "2026-03-02T08:00:00Z",
        endDate: "2026-03-02T10:00:00Z",
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      docId: "wo-a2",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-A",
        manufacturingOrderId: "MO-A2",
        workCenterId: "wc-fanout-deterministic",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T11:00:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
    {
      docId: "wo-a1",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-A",
        manufacturingOrderId: "MO-A1",
        workCenterId: "wc-fanout-deterministic",
        startDate: "2026-03-02T10:00:00Z",
        endDate: "2026-03-02T11:00:00Z",
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-parent"],
      },
    },
  ];

  const manufacturingOrders: ManufacturingOrderDoc[] = [
    {
      docId: "MO-PARENT",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-PARENT",
        itemId: "SKU-PARENT",
        quantity: 1,
        dueDate: "2026-03-05T00:00:00Z",
      },
    },
    {
      docId: "MO-A1",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-A1",
        itemId: "SKU-A1",
        quantity: 1,
        dueDate: "2026-03-03T00:00:00Z",
      },
    },
    {
      docId: "MO-A2",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-A2",
        itemId: "SKU-A2",
        quantity: 1,
        dueDate: "2026-03-03T00:00:00Z",
      },
    },
  ];

  const result = service.reflow({ workCenters: [workCenter], workOrders, manufacturingOrders });
  const a1 = findById(result.updatedWorkOrders, "wo-a1");
  const a2 = findById(result.updatedWorkOrders, "wo-a2");

  assert.equal(a1.data.startDate, "2026-03-02T10:00:00Z");
  assert.equal(a2.data.startDate, "2026-03-02T11:00:00Z");
});

test("reflow throws on circular dependency graph", () => {
  const input = delayCascadeScenario();
  input.workOrders = [
    {
      ...input.workOrders[0],
      data: { ...input.workOrders[0].data, dependsOnWorkOrderIds: ["wo-3"] },
    },
    ...input.workOrders.slice(1),
  ];

  assert.throws(() => service.reflow(input), /Circular dependency detected/);
});

test("setupTimeMinutes is counted as working time within shifts", () => {
  const workCenter: WorkCenterDoc = {
    docId: "wc-setup",
    docType: "workCenter",
    data: {
      name: "Line Setup",
      shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }, { dayOfWeek: 2, startHour: 8, endHour: 17 }],
      maintenanceWindows: [],
    },
  };

  const workOrders: WorkOrderDoc[] = [
    {
      docId: "wo-setup-1",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-SETUP-1",
        manufacturingOrderId: "MO-SETUP-1",
        workCenterId: "wc-setup",
        startDate: "2026-03-02T16:00:00Z",
        endDate: "2026-03-02T17:00:00Z",
        durationMinutes: 60,
        setupTimeMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
  ];

  const input: ReflowInput = { workCenters: [workCenter], workOrders };
  const result = service.reflow(input);
  const order = findById(result.updatedWorkOrders, "wo-setup-1");

  assert.equal(order.data.startDate, "2026-03-02T16:00:00Z");
  assert.equal(order.data.endDate, "2026-03-03T09:00:00Z");
});
