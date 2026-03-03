import { toUtc } from "../utils/date-utils.js";
import type { ManufacturingOrderDoc, WorkCenterDoc, WorkOrderDoc } from "./types.js";
import { buildWorkOrderDependencyDag } from "./dependency-dag.js";

export function assertNoDependencyCycles(workOrders: WorkOrderDoc[]): void {
  buildWorkOrderDependencyDag(workOrders).assertAcyclic();
}

export function topologicalSort(
  workOrders: WorkOrderDoc[],
  manufacturingOrders: ManufacturingOrderDoc[] = [],
): WorkOrderDoc[] {
  const {
    branchTotalMinutesByWorkOrderId,
    crossCenterUnlockMinutesByWorkOrderId,
  } = buildSchedulingHeuristics(workOrders);
  const dueDateByManufacturingOrderId = new Map(
    manufacturingOrders.map((mo) => [mo.docId, toUtc(mo.data.dueDate).toMillis()]),
  );

  return buildWorkOrderDependencyDag(workOrders).topologicalSort(
    (a, b) => {
      const byStartDate = toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis();
      if (byStartDate !== 0) return byStartDate;

      const slackA = getDueDateSlackMillis(a, dueDateByManufacturingOrderId);
      const slackB = getDueDateSlackMillis(b, dueDateByManufacturingOrderId);
      if (slackA !== slackB) return slackA - slackB;

      const durationA = getTotalDurationMinutes(a);
      const durationB = getTotalDurationMinutes(b);
      if (durationA !== durationB) return durationA - durationB;

      const crossCenterA = crossCenterUnlockMinutesByWorkOrderId.get(a.docId) ?? Number.POSITIVE_INFINITY;
      const crossCenterB = crossCenterUnlockMinutesByWorkOrderId.get(b.docId) ?? Number.POSITIVE_INFINITY;
      if (crossCenterA !== crossCenterB) return crossCenterA - crossCenterB;

      const branchA = branchTotalMinutesByWorkOrderId.get(a.docId) ?? durationA;
      const branchB = branchTotalMinutesByWorkOrderId.get(b.docId) ?? durationB;
      if (branchA !== branchB) return branchA - branchB;

      const byWorkOrderNumber = a.data.workOrderNumber.localeCompare(b.data.workOrderNumber);
      if (byWorkOrderNumber !== 0) return byWorkOrderNumber;

      return a.docId.localeCompare(b.docId);
    },
  );
}

function getDueDateSlackMillis(
  workOrder: WorkOrderDoc,
  dueDateByManufacturingOrderId: Map<string, number>,
): number {
  const dueDateMillis = dueDateByManufacturingOrderId.get(workOrder.data.manufacturingOrderId);
  if (dueDateMillis === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return dueDateMillis - toUtc(workOrder.data.endDate).toMillis();
}

function getTotalDurationMinutes(workOrder: WorkOrderDoc): number {
  return workOrder.data.durationMinutes + (workOrder.data.setupTimeMinutes ?? 0);
}

function buildSchedulingHeuristics(workOrders: WorkOrderDoc[]): {
  branchTotalMinutesByWorkOrderId: Map<string, number>;
  crossCenterUnlockMinutesByWorkOrderId: Map<string, number>;
} {
  const byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
  const childrenById = new Map<string, string[]>();

  for (const wo of workOrders) {
    for (const parentId of wo.data.dependsOnWorkOrderIds) {
      if (!childrenById.has(parentId)) childrenById.set(parentId, []);
      childrenById.get(parentId)!.push(wo.docId);
    }
  }

  const branchMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const crossCenterUnlockMinutesByWorkOrderId = new Map<string, number>();

  for (const wo of workOrders) {
    let best = Number.POSITIVE_INFINITY;
    for (const childId of childrenById.get(wo.docId) ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.data.workCenterId !== wo.data.workCenterId) {
        const childDuration = getTotalDurationMinutes(child);
        if (childDuration < best) best = childDuration;
      }
    }
    crossCenterUnlockMinutesByWorkOrderId.set(wo.docId, best);
  }

  const visit = (id: string): number => {
    if (branchMemo.has(id)) return branchMemo.get(id)!;
    if (visiting.has(id)) {
      return getTotalDurationMinutes(byId.get(id)!);
    }

    const current = byId.get(id);
    if (!current) return 0;

    visiting.add(id);
    const own = getTotalDurationMinutes(current);
    let childrenTotal = 0;

    for (const childId of childrenById.get(id) ?? []) {
      childrenTotal += visit(childId);
    }

    visiting.delete(id);
    const total = own + childrenTotal;
    branchMemo.set(id, total);
    return total;
  };

  for (const wo of workOrders) {
    visit(wo.docId);
  }

  return {
    branchTotalMinutesByWorkOrderId: branchMemo,
    crossCenterUnlockMinutesByWorkOrderId,
  };
}

export function assertNoOverlapsByWorkCenter(
  workOrders: WorkOrderDoc[],
  workCenters: WorkCenterDoc[],
): void {
  const byWorkCenter = new Map<string, WorkOrderDoc[]>();
  for (const wc of workCenters) {
    byWorkCenter.set(wc.docId, []);
  }

  for (const wo of workOrders) {
    if (!byWorkCenter.has(wo.data.workCenterId)) {
      throw new Error(`Work order ${wo.docId} references unknown work center ${wo.data.workCenterId}`);
    }
    byWorkCenter.get(wo.data.workCenterId)!.push(wo);
  }

  for (const [workCenterId, orders] of byWorkCenter) {
    orders.sort((a, b) => toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis());
    for (let i = 1; i < orders.length; i += 1) {
      const prev = orders[i - 1];
      const curr = orders[i];
      if (toUtc(curr.data.startDate) < toUtc(prev.data.endDate)) {
        throw new Error(
          `Overlap detected in work center ${workCenterId}: ${prev.data.workOrderNumber} and ${curr.data.workOrderNumber}`,
        );
      }
    }
  }
}

export function assertDependenciesSatisfied(workOrders: WorkOrderDoc[]): void {
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
        throw new Error(
          `Dependency violation: ${wo.data.workOrderNumber} starts before ${parent.data.workOrderNumber} finishes`,
        );
      }
    }
  }
}
