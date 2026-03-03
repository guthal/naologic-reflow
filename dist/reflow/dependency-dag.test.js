import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkOrderDependencyDag } from "./dependency-dag.js";
function wo(id, dependsOnWorkOrderIds = []) {
    return {
        docId: id,
        docType: "workOrder",
        data: {
            workOrderNumber: `WO-${id}`,
            manufacturingOrderId: `MO-${id}`,
            workCenterId: "wc-1",
            startDate: "2026-03-02T08:00:00Z",
            endDate: "2026-03-02T09:00:00Z",
            durationMinutes: 60,
            isMaintenance: false,
            dependsOnWorkOrderIds,
        },
    };
}
test("topologicalSort orders parents before children", () => {
    const workOrders = [wo("c", ["a", "b"]), wo("a"), wo("b", ["a"])];
    const dag = buildWorkOrderDependencyDag(workOrders);
    const sorted = dag.topologicalSort();
    const indexById = new Map(sorted.map((item, index) => [item.docId, index]));
    assert.ok((indexById.get("a") ?? -1) < (indexById.get("b") ?? -1));
    assert.ok((indexById.get("a") ?? -1) < (indexById.get("c") ?? -1));
    assert.ok((indexById.get("b") ?? -1) < (indexById.get("c") ?? -1));
});
test("assertAcyclic throws on circular dependencies", () => {
    const workOrders = [wo("a", ["c"]), wo("b", ["a"]), wo("c", ["b"])];
    const dag = buildWorkOrderDependencyDag(workOrders);
    assert.throws(() => dag.assertAcyclic(), /Circular dependency detected/);
});
test("dag creation fails if a dependency is missing", () => {
    assert.throws(() => buildWorkOrderDependencyDag([wo("a", ["missing-id"])]), /Missing dependency missing-id referenced by a/);
});
