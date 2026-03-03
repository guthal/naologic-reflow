import { ReflowService } from "./reflow/reflow.service.js";
import {
  delayCascadeScenario,
  maintenanceConflictScenario,
  shiftBoundaryScenario,
} from "./sample-data/scenarios.js";

const service = new ReflowService();

const scenarios = [
  { name: "Delay Cascade", input: delayCascadeScenario() },
  { name: "Shift Boundary", input: shiftBoundaryScenario() },
  { name: "Maintenance Conflict", input: maintenanceConflictScenario() },
];

for (const scenario of scenarios) {
  const result = service.reflow(scenario.input);
  // eslint-disable-next-line no-console
  console.log(`\n=== ${scenario.name} ===`);
  // eslint-disable-next-line no-console
  console.log(result.explanation);
  // eslint-disable-next-line no-console
  console.table(
    result.updatedWorkOrders.map((wo) => ({
      workOrder: wo.data.workOrderNumber,
      workCenter: wo.data.workCenterId,
      startDate: wo.data.startDate,
      endDate: wo.data.endDate,
      durationMinutes: wo.data.durationMinutes,
      isMaintenance: wo.data.isMaintenance,
      dependsOn: wo.data.dependsOnWorkOrderIds.join(", "),
    })),
  );
  // eslint-disable-next-line no-console
  console.table(result.changes);
}
