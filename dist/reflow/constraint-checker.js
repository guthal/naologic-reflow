import { toUtc } from "../utils/date-utils.js";
import { buildWorkOrderDependencyDag } from "./dependency-dag.js";
export function assertNoDependencyCycles(workOrders) {
    buildWorkOrderDependencyDag(workOrders).assertAcyclic();
}
export function topologicalSort(workOrders) {
    return buildWorkOrderDependencyDag(workOrders).topologicalSort((a, b) => toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis());
}
export function assertNoOverlapsByWorkCenter(workOrders, workCenters) {
    const byWorkCenter = new Map();
    for (const wc of workCenters) {
        byWorkCenter.set(wc.docId, []);
    }
    for (const wo of workOrders) {
        if (!byWorkCenter.has(wo.data.workCenterId)) {
            throw new Error(`Work order ${wo.docId} references unknown work center ${wo.data.workCenterId}`);
        }
        byWorkCenter.get(wo.data.workCenterId).push(wo);
    }
    for (const [workCenterId, orders] of byWorkCenter) {
        orders.sort((a, b) => toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis());
        for (let i = 1; i < orders.length; i += 1) {
            const prev = orders[i - 1];
            const curr = orders[i];
            if (toUtc(curr.data.startDate) < toUtc(prev.data.endDate)) {
                throw new Error(`Overlap detected in work center ${workCenterId}: ${prev.data.workOrderNumber} and ${curr.data.workOrderNumber}`);
            }
        }
    }
}
export function assertDependenciesSatisfied(workOrders) {
    const byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
    for (const wo of workOrders) {
        const currentStart = toUtc(wo.data.startDate);
        for (const parentId of wo.data.dependsOnWorkOrderIds) {
            const parent = byId.get(parentId);
            if (!parent) {
                throw new Error(`Missing dependency ${parentId} for work order ${wo.docId}`);
            }
            const parentEnd = toUtc(parent.data.endDate);
            if (currentStart < parentEnd) {
                throw new Error(`Dependency violation: ${wo.data.workOrderNumber} starts before ${parent.data.workOrderNumber} finishes`);
            }
        }
    }
}
