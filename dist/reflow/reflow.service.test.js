import test from "node:test";
import assert from "node:assert/strict";
import { ReflowService } from "./reflow.service.js";
import { assertDependenciesSatisfied, assertNoOverlapsByWorkCenter } from "./constraint-checker.js";
import { delayCascadeScenario, maintenanceConflictScenario, shiftBoundaryScenario } from "../sample-data/scenarios.js";
const service = new ReflowService();
function mapByOrderNumber(workOrders) {
    return new Map(workOrders.map((wo) => [wo.data.workOrderNumber, wo]));
}
function findById(workOrders, id) {
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
    assert.match(wo1002Change.reason, /work-center queue/i);
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
    const workCenter = {
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
    const workOrders = [
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
    const input = { workCenters: [workCenter], workOrders };
    const result = service.reflow(input);
    const child = findById(result.updatedWorkOrders, "wo-child");
    assert.equal(child.data.startDate, "2026-03-02T13:00:00Z");
    assert.equal(child.data.endDate, "2026-03-02T14:00:00Z");
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
    const workCenter = {
        docId: "wc-setup",
        docType: "workCenter",
        data: {
            name: "Line Setup",
            shifts: [{ dayOfWeek: 1, startHour: 8, endHour: 17 }, { dayOfWeek: 2, startHour: 8, endHour: 17 }],
            maintenanceWindows: [],
        },
    };
    const workOrders = [
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
    const input = { workCenters: [workCenter], workOrders };
    const result = service.reflow(input);
    const order = findById(result.updatedWorkOrders, "wo-setup-1");
    assert.equal(order.data.startDate, "2026-03-02T16:00:00Z");
    assert.equal(order.data.endDate, "2026-03-03T09:00:00Z");
});
