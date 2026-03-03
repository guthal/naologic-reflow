export class WorkOrderDependencyDag {
    byId;
    childrenById;
    parentCountById;
    constructor(workOrders) {
        this.byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
        this.childrenById = new Map();
        this.parentCountById = new Map(workOrders.map((wo) => [wo.docId, 0]));
        for (const wo of workOrders) {
            for (const parentId of wo.data.dependsOnWorkOrderIds) {
                if (!this.byId.has(parentId)) {
                    throw new Error(`Missing dependency ${parentId} referenced by ${wo.docId}`);
                }
                if (!this.childrenById.has(parentId))
                    this.childrenById.set(parentId, []);
                this.childrenById.get(parentId).push(wo.docId);
                this.parentCountById.set(wo.docId, (this.parentCountById.get(wo.docId) ?? 0) + 1);
            }
        }
    }
    assertAcyclic() {
        const visiting = new Set();
        const visited = new Set();
        const visit = (id) => {
            if (visited.has(id))
                return;
            if (visiting.has(id)) {
                throw new Error(`Circular dependency detected at work order ${id}`);
            }
            const wo = this.byId.get(id);
            if (!wo) {
                throw new Error(`Unknown work order in dependency graph: ${id}`);
            }
            visiting.add(id);
            for (const parentId of wo.data.dependsOnWorkOrderIds) {
                visit(parentId);
            }
            visiting.delete(id);
            visited.add(id);
        };
        for (const wo of this.byId.values()) {
            visit(wo.docId);
        }
    }
    topologicalSort(tieBreaker) {
        const parentCount = new Map(this.parentCountById);
        const queue = Array.from(this.byId.values()).filter((wo) => (parentCount.get(wo.docId) ?? 0) === 0);
        if (tieBreaker)
            queue.sort(tieBreaker);
        const sorted = [];
        while (queue.length > 0) {
            const current = queue.shift();
            sorted.push(current);
            for (const childId of this.childrenById.get(current.docId) ?? []) {
                parentCount.set(childId, (parentCount.get(childId) ?? 0) - 1);
                if ((parentCount.get(childId) ?? 0) === 0) {
                    queue.push(this.byId.get(childId));
                    if (tieBreaker)
                        queue.sort(tieBreaker);
                }
            }
        }
        if (sorted.length !== this.byId.size) {
            throw new Error("Topological sort failed. Graph may contain a cycle.");
        }
        return sorted;
    }
    edges() {
        const edges = [];
        for (const wo of this.byId.values()) {
            for (const parentId of wo.data.dependsOnWorkOrderIds) {
                edges.push({ from: parentId, to: wo.docId });
            }
        }
        return edges;
    }
}
export function buildWorkOrderDependencyDag(workOrders) {
    return new WorkOrderDependencyDag(workOrders);
}
