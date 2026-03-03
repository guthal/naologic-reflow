import { toUtc } from "../utils/date-utils.js";
import type { WorkCenterDoc, WorkOrderDoc } from "./types.js";

export function assertNoDependencyCycles(workOrders: WorkOrderDoc[]): void {
  const byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Circular dependency detected at work order ${id}`);
    }

    visiting.add(id);
    const order = byId.get(id);
    if (!order) {
      throw new Error(`Unknown work order in dependency graph: ${id}`);
    }

    for (const parentId of order.data.dependsOnWorkOrderIds) {
      if (!byId.has(parentId)) {
        throw new Error(`Missing dependency ${parentId} referenced by ${id}`);
      }
      visit(parentId);
    }

    visiting.delete(id);
    visited.add(id);
  }

  for (const wo of workOrders) {
    visit(wo.docId);
  }
}

export function topologicalSort(workOrders: WorkOrderDoc[]): WorkOrderDoc[] {
  const byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const wo of workOrders) {
    inDegree.set(wo.docId, wo.data.dependsOnWorkOrderIds.length);
    for (const parent of wo.data.dependsOnWorkOrderIds) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent)!.push(wo.docId);
    }
  }

  const queue = workOrders
    .filter((wo) => (inDegree.get(wo.docId) ?? 0) === 0)
    .sort((a, b) => toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis());

  const sorted: WorkOrderDoc[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const child of children.get(current.docId) ?? []) {
      inDegree.set(child, (inDegree.get(child) ?? 0) - 1);
      if ((inDegree.get(child) ?? 0) === 0) {
        queue.push(byId.get(child)!);
        queue.sort((a, b) => toUtc(a.data.startDate).toMillis() - toUtc(b.data.startDate).toMillis());
      }
    }
  }

  if (sorted.length !== workOrders.length) {
    throw new Error("Topological sort failed. Graph may contain a cycle.");
  }

  return sorted;
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
