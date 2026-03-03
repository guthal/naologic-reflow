import { DateTime } from "luxon";
import {
  assertDependenciesSatisfied,
  assertNoDependencyCycles,
  assertNoOverlapsByWorkCenter,
  topologicalSort,
} from "./constraint-checker.js";
import type { ReflowInput, ReflowResult, WorkCenterDoc, WorkOrderChange, WorkOrderDoc } from "./types.js";
import {
  buildBlockedWindows,
  calculateEndDateWithCalendar,
  findEarliestWorkingMoment,
  minutesDiff,
  toIsoUtc,
  toUtc,
} from "../utils/date-utils.js";

export class ReflowService {
  reflow(input: ReflowInput): ReflowResult {
    assertNoDependencyCycles(input.workOrders);

    const byWorkCenter = new Map(input.workCenters.map((wc) => [wc.docId, wc]));
    const byOrderId = new Map(input.workOrders.map((wo) => [wo.docId, wo]));

    const fixedOrders = input.workOrders.filter((wo) => wo.data.isMaintenance);
    const sortedMovable = topologicalSort(input.workOrders).filter((wo) => !wo.data.isMaintenance);

    const fixedByWorkCenter = groupByWorkCenter(fixedOrders);
    const workCenterCursor = new Map<string, DateTime>();
    const scheduledById = new Map<string, WorkOrderDoc>();

    for (const fixed of fixedOrders) {
      scheduledById.set(fixed.docId, cloneWorkOrder(fixed));
    }

    for (const order of sortedMovable) {
      const workCenter = byWorkCenter.get(order.data.workCenterId);
      if (!workCenter) {
        throw new Error(`Unknown work center ${order.data.workCenterId} for ${order.docId}`);
      }

      const blockedWindows = buildBlockedWindows(workCenter, fixedByWorkCenter.get(workCenter.docId) ?? []);
      const depsEnd = getDependenciesLatestEnd(order, scheduledById, byOrderId);
      const originalStart = toUtc(order.data.startDate);
      const cursor = workCenterCursor.get(workCenter.docId);

      const notBefore = maxDate([originalStart, depsEnd, cursor].filter(Boolean) as DateTime[]);
      const startDate = findEarliestWorkingMoment(workCenter, blockedWindows, notBefore);
      const endDate = calculateEndDateWithCalendar(
        workCenter,
        blockedWindows,
        startDate,
        order.data.durationMinutes,
      );

      const updatedOrder: WorkOrderDoc = {
        ...order,
        data: {
          ...order.data,
          startDate: toIsoUtc(startDate),
          endDate: toIsoUtc(endDate),
        },
      };

      scheduledById.set(order.docId, updatedOrder);
      workCenterCursor.set(workCenter.docId, endDate);
    }

    const updatedWorkOrders = input.workOrders.map((wo) => scheduledById.get(wo.docId)!);
    assertDependenciesSatisfied(updatedWorkOrders);
    assertNoOverlapsByWorkCenter(updatedWorkOrders, input.workCenters);

    const changes = buildChanges(input.workOrders, updatedWorkOrders);
    const explanation = buildExplanation(changes, input.workCenters);

    return {
      updatedWorkOrders,
      changes,
      explanation,
    };
  }
}

function groupByWorkCenter(workOrders: WorkOrderDoc[]): Map<string, WorkOrderDoc[]> {
  const grouped = new Map<string, WorkOrderDoc[]>();
  for (const wo of workOrders) {
    if (!grouped.has(wo.data.workCenterId)) grouped.set(wo.data.workCenterId, []);
    grouped.get(wo.data.workCenterId)!.push(wo);
  }
  return grouped;
}

function getDependenciesLatestEnd(
  order: WorkOrderDoc,
  scheduledById: Map<string, WorkOrderDoc>,
  fallbackById: Map<string, WorkOrderDoc>,
): DateTime {
  let latest = toUtc("1970-01-01T00:00:00Z");
  for (const depId of order.data.dependsOnWorkOrderIds) {
    const dep = scheduledById.get(depId) ?? fallbackById.get(depId);
    if (!dep) {
      throw new Error(`Dependency ${depId} not found for ${order.docId}`);
    }
    const depEnd = toUtc(dep.data.endDate);
    if (depEnd > latest) latest = depEnd;
  }
  return latest;
}

function maxDate(dates: DateTime[]): DateTime {
  return dates.reduce((acc, curr) => (curr > acc ? curr : acc));
}

function cloneWorkOrder(wo: WorkOrderDoc): WorkOrderDoc {
  return {
    ...wo,
    data: { ...wo.data, dependsOnWorkOrderIds: [...wo.data.dependsOnWorkOrderIds] },
  };
}

function buildChanges(original: WorkOrderDoc[], updated: WorkOrderDoc[]): WorkOrderChange[] {
  const updatedById = new Map(updated.map((wo) => [wo.docId, wo]));
  const changes: WorkOrderChange[] = [];

  for (const oldOrder of original) {
    const newOrder = updatedById.get(oldOrder.docId)!;
    if (
      oldOrder.data.startDate !== newOrder.data.startDate ||
      oldOrder.data.endDate !== newOrder.data.endDate
    ) {
      changes.push({
        workOrderId: oldOrder.docId,
        workOrderNumber: oldOrder.data.workOrderNumber,
        oldStartDate: oldOrder.data.startDate,
        newStartDate: newOrder.data.startDate,
        oldEndDate: oldOrder.data.endDate,
        newEndDate: newOrder.data.endDate,
        startShiftMinutes: minutesDiff(toUtc(oldOrder.data.startDate), toUtc(newOrder.data.startDate)),
        endShiftMinutes: minutesDiff(toUtc(oldOrder.data.endDate), toUtc(newOrder.data.endDate)),
        reason: "Dependency, shift, maintenance, or work-center conflict resolution",
      });
    }
  }

  return changes;
}

function buildExplanation(changes: WorkOrderChange[], workCenters: WorkCenterDoc[]): string {
  if (changes.length === 0) {
    return "No schedule updates were required. Existing plan already satisfies all constraints.";
  }
  return [
    `Reflow moved ${changes.length} work order(s) to satisfy hard constraints.`,
    "Constraints enforced: dependency completion, one-order-per-work-center, shift hours, and maintenance blocks.",
    `Work centers considered: ${workCenters.map((wc) => wc.data.name).join(", ")}.`,
  ].join(" ");
}
