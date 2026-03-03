import { assertDependenciesSatisfied, assertNoDependencyCycles, assertNoOverlapsByWorkCenter, topologicalSort, } from "./constraint-checker.js";
import { buildBlockedWindows, calculateEndDateWithCalendar, findEarliestWorkingMoment, minutesDiff, toIsoUtc, toUtc, } from "../utils/date-utils.js";
export class ReflowService {
    reflow(input) {
        assertNoDependencyCycles(input.workOrders);
        const byWorkCenter = new Map(input.workCenters.map((wc) => [wc.docId, wc]));
        const byOrderId = new Map(input.workOrders.map((wo) => [wo.docId, wo]));
        const fixedOrders = input.workOrders.filter((wo) => wo.data.isMaintenance);
        const sortedMovable = topologicalSort(input.workOrders).filter((wo) => !wo.data.isMaintenance);
        const fixedByWorkCenter = groupByWorkCenter(fixedOrders);
        const workCenterCursor = new Map();
        const scheduledById = new Map();
        const reasonByOrderId = new Map();
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
            const notBefore = maxDate([originalStart, depsEnd, cursor].filter(Boolean));
            const startDate = findEarliestWorkingMoment(workCenter, blockedWindows, notBefore);
            const totalWorkingMinutes = getTotalWorkingMinutes(order);
            const endDate = calculateEndDateWithCalendar(workCenter, blockedWindows, startDate, totalWorkingMinutes);
            const updatedOrder = {
                ...order,
                data: {
                    ...order.data,
                    startDate: toIsoUtc(startDate),
                    endDate: toIsoUtc(endDate),
                },
            };
            scheduledById.set(order.docId, updatedOrder);
            workCenterCursor.set(workCenter.docId, endDate);
            reasonByOrderId.set(order.docId, buildRescheduleReason({
                order,
                workCenter,
                blockedWindows,
                originalStart,
                depsEnd,
                cursor,
                notBefore,
                startDate,
            }));
        }
        const updatedWorkOrders = input.workOrders.map((wo) => scheduledById.get(wo.docId));
        assertDependenciesSatisfied(updatedWorkOrders);
        assertNoOverlapsByWorkCenter(updatedWorkOrders, input.workCenters);
        const changes = buildChanges(input.workOrders, updatedWorkOrders, reasonByOrderId);
        const explanation = buildExplanation(changes, input.workCenters);
        return {
            updatedWorkOrders,
            changes,
            explanation,
        };
    }
}
function groupByWorkCenter(workOrders) {
    const grouped = new Map();
    for (const wo of workOrders) {
        if (!grouped.has(wo.data.workCenterId))
            grouped.set(wo.data.workCenterId, []);
        grouped.get(wo.data.workCenterId).push(wo);
    }
    return grouped;
}
function getDependenciesLatestEnd(order, scheduledById, fallbackById) {
    let latest = toUtc("1970-01-01T00:00:00Z");
    for (const depId of order.data.dependsOnWorkOrderIds) {
        const dep = scheduledById.get(depId) ?? fallbackById.get(depId);
        if (!dep) {
            throw new Error(`Dependency ${depId} not found for ${order.docId}`);
        }
        const depEnd = toUtc(dep.data.endDate);
        if (depEnd > latest)
            latest = depEnd;
    }
    return latest;
}
function maxDate(dates) {
    return dates.reduce((acc, curr) => (curr > acc ? curr : acc));
}
function getTotalWorkingMinutes(order) {
    const setup = order.data.setupTimeMinutes ?? 0;
    if (setup < 0) {
        throw new Error(`setupTimeMinutes cannot be negative for ${order.docId}`);
    }
    return order.data.durationMinutes + setup;
}
function buildRescheduleReason(args) {
    const { order, workCenter, blockedWindows, originalStart, depsEnd, cursor, notBefore, startDate } = args;
    const reasons = [];
    if (order.data.dependsOnWorkOrderIds.length > 0 && depsEnd > originalStart) {
        reasons.push(`dependency wait until ${toIsoUtc(depsEnd)}`);
    }
    if (cursor && cursor > maxDate([originalStart, depsEnd])) {
        reasons.push(`work-center queue on ${workCenter.data.name} until ${toIsoUtc(cursor)}`);
    }
    if (startDate > notBefore) {
        const activeBlock = getActiveBlock(blockedWindows, notBefore);
        if (activeBlock) {
            reasons.push(`blocked by ${activeBlock.reason} until ${toIsoUtc(activeBlock.end)}`);
        }
        if (!isInShift(workCenter, notBefore)) {
            reasons.push(`outside shift hours, resumed at ${toIsoUtc(startDate)}`);
        }
    }
    if ((order.data.setupTimeMinutes ?? 0) > 0) {
        reasons.push(`includes setup time (${order.data.setupTimeMinutes}m) as working time within shift calendar`);
    }
    if (reasons.length === 0) {
        return "No date movement required after constraint evaluation.";
    }
    return reasons.join("; ");
}
function isInShift(workCenter, at) {
    const dayOfWeek = at.weekday % 7;
    const hour = at.hour + at.minute / 60;
    return workCenter.data.shifts.some((shift) => shift.dayOfWeek === dayOfWeek && hour >= shift.startHour && hour < shift.endHour);
}
function getActiveBlock(blockedWindows, at) {
    for (const window of blockedWindows) {
        if (at >= window.start && at < window.end)
            return window;
    }
    return null;
}
function cloneWorkOrder(wo) {
    return {
        ...wo,
        data: { ...wo.data, dependsOnWorkOrderIds: [...wo.data.dependsOnWorkOrderIds] },
    };
}
function buildChanges(original, updated, reasonByOrderId) {
    const updatedById = new Map(updated.map((wo) => [wo.docId, wo]));
    const changes = [];
    for (const oldOrder of original) {
        const newOrder = updatedById.get(oldOrder.docId);
        if (oldOrder.data.startDate !== newOrder.data.startDate ||
            oldOrder.data.endDate !== newOrder.data.endDate) {
            changes.push({
                workOrderId: oldOrder.docId,
                workOrderNumber: oldOrder.data.workOrderNumber,
                oldStartDate: oldOrder.data.startDate,
                newStartDate: newOrder.data.startDate,
                oldEndDate: oldOrder.data.endDate,
                newEndDate: newOrder.data.endDate,
                startShiftMinutes: minutesDiff(toUtc(oldOrder.data.startDate), toUtc(newOrder.data.startDate)),
                endShiftMinutes: minutesDiff(toUtc(oldOrder.data.endDate), toUtc(newOrder.data.endDate)),
                reason: reasonByOrderId.get(oldOrder.docId) ?? "Rescheduled to satisfy constraints.",
            });
        }
    }
    return changes;
}
function buildExplanation(changes, workCenters) {
    if (changes.length === 0) {
        return "No schedule updates were required. Existing plan already satisfies all constraints.";
    }
    return [
        `Reflow moved ${changes.length} work order(s) to satisfy hard constraints.`,
        "Constraints enforced: dependency completion, one-order-per-work-center, shift hours, and maintenance blocks.",
        `Work centers considered: ${workCenters.map((wc) => wc.data.name).join(", ")}.`,
    ].join(" ");
}
