import { DateTime, Interval } from "luxon";
const MINUTES_IN_MILLISECOND = 60_000;
export function toUtc(value) {
    const dt = DateTime.fromISO(value, { zone: "utc" });
    if (!dt.isValid) {
        throw new Error(`Invalid ISO date: ${value}`);
    }
    return dt;
}
export function toIsoUtc(value) {
    return value.toUTC().toISO({ suppressMilliseconds: true }) ?? value.toUTC().toISO();
}
export function buildBlockedWindows(workCenter, fixedMaintenanceOrders) {
    const windows = [];
    for (const window of workCenter.data.maintenanceWindows) {
        windows.push({
            start: toUtc(window.startDate),
            end: toUtc(window.endDate),
            reason: window.reason ?? "maintenance-window",
        });
    }
    for (const wo of fixedMaintenanceOrders) {
        windows.push({
            start: toUtc(wo.data.startDate),
            end: toUtc(wo.data.endDate),
            reason: `maintenance-work-order:${wo.data.workOrderNumber}`,
        });
    }
    return windows
        .filter((w) => w.end > w.start)
        .sort((a, b) => a.start.toMillis() - b.start.toMillis());
}
function inShift(workCenter, at) {
    const dayShifts = workCenter.data.shifts.filter((s) => s.dayOfWeek === at.weekday % 7);
    const hour = at.hour + at.minute / 60;
    return dayShifts.some((s) => hour >= s.startHour && hour < s.endHour);
}
function getShiftEnd(workCenter, at) {
    const dayShifts = workCenter.data.shifts
        .filter((s) => s.dayOfWeek === at.weekday % 7)
        .sort((a, b) => a.startHour - b.startHour);
    for (const shift of dayShifts) {
        const shiftStart = at.startOf("day").plus({ hours: shift.startHour });
        const shiftEnd = at.startOf("day").plus({ hours: shift.endHour });
        if (at >= shiftStart && at < shiftEnd) {
            return shiftEnd;
        }
    }
    return null;
}
function nextShiftStart(workCenter, after) {
    for (let dayOffset = 0; dayOffset < 15; dayOffset += 1) {
        const day = after.startOf("day").plus({ days: dayOffset });
        const dayShifts = workCenter.data.shifts
            .filter((s) => s.dayOfWeek === day.weekday % 7)
            .sort((a, b) => a.startHour - b.startHour);
        for (const shift of dayShifts) {
            const shiftStart = day.plus({ hours: shift.startHour });
            if (shiftStart > after) {
                return shiftStart;
            }
        }
    }
    throw new Error(`No shift availability found for work center ${workCenter.docId}. Check shift config.`);
}
function getActiveBlock(blockedWindows, at) {
    for (const window of blockedWindows) {
        if (at >= window.start && at < window.end) {
            return window;
        }
    }
    return null;
}
function getNextBlockStart(blockedWindows, after) {
    for (const window of blockedWindows) {
        if (window.start > after) {
            return window.start;
        }
    }
    return null;
}
export function findEarliestWorkingMoment(workCenter, blockedWindows, notBefore) {
    let cursor = notBefore;
    while (true) {
        if (!inShift(workCenter, cursor)) {
            cursor = nextShiftStart(workCenter, cursor);
            continue;
        }
        const activeBlock = getActiveBlock(blockedWindows, cursor);
        if (activeBlock) {
            cursor = activeBlock.end;
            continue;
        }
        return cursor;
    }
}
export function calculateEndDateWithCalendar(workCenter, blockedWindows, startDate, durationMinutes) {
    if (durationMinutes <= 0) {
        return startDate;
    }
    let remaining = durationMinutes;
    let cursor = startDate;
    while (remaining > 0) {
        cursor = findEarliestWorkingMoment(workCenter, blockedWindows, cursor);
        const shiftEnd = getShiftEnd(workCenter, cursor);
        if (!shiftEnd) {
            cursor = nextShiftStart(workCenter, cursor);
            continue;
        }
        const nextBlockStart = getNextBlockStart(blockedWindows, cursor);
        const availableUntil = nextBlockStart && nextBlockStart < shiftEnd ? nextBlockStart : shiftEnd;
        if (availableUntil <= cursor) {
            cursor = availableUntil.plus({ minutes: 1 });
            continue;
        }
        const availableMinutes = Math.floor(Interval.fromDateTimes(cursor, availableUntil).toDuration("minutes").minutes);
        const workNow = Math.min(remaining, availableMinutes);
        cursor = cursor.plus({ milliseconds: workNow * MINUTES_IN_MILLISECOND });
        remaining -= workNow;
    }
    return cursor;
}
export function minutesDiff(a, b) {
    return Math.round((b.toMillis() - a.toMillis()) / MINUTES_IN_MILLISECOND);
}
