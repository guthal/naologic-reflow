import type { WorkOrderDoc } from "./types.js";

export interface DagEdge {
  from: string;
  to: string;
}

export class WorkOrderDependencyDag {
  private readonly byId: Map<string, WorkOrderDoc>;
  private readonly childrenById: Map<string, string[]>;
  private readonly parentCountById: Map<string, number>;
  private readonly inputOrderById: Map<string, number>;

  constructor(workOrders: WorkOrderDoc[]) {
    this.byId = new Map(workOrders.map((wo) => [wo.docId, wo]));
    this.childrenById = new Map();
    this.parentCountById = new Map(workOrders.map((wo) => [wo.docId, 0]));
    this.inputOrderById = new Map(workOrders.map((wo, index) => [wo.docId, index]));

    for (const wo of workOrders) {
      for (const parentId of wo.data.dependsOnWorkOrderIds) {
        if (!this.byId.has(parentId)) {
          throw new Error(`Missing dependency ${parentId} referenced by ${wo.docId}`);
        }
        if (!this.childrenById.has(parentId)) this.childrenById.set(parentId, []);
        this.childrenById.get(parentId)!.push(wo.docId);
        this.parentCountById.set(wo.docId, (this.parentCountById.get(wo.docId) ?? 0) + 1);
      }
    }
  }

  assertAcyclic(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
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

  topologicalSort(
    tieBreaker?: (a: WorkOrderDoc, b: WorkOrderDoc) => number,
  ): WorkOrderDoc[] {
    const parentCount = new Map(this.parentCountById);

    const sorted: WorkOrderDoc[] = [];
    const rootItems = Array.from(this.byId.values()).filter(
      (wo) => (parentCount.get(wo.docId) ?? 0) === 0,
    );

    if (tieBreaker) {
      const heap = new MinHeap<WorkOrderDoc>((a, b) => {
        const byTieBreak = tieBreaker(a, b);
        if (byTieBreak !== 0) return byTieBreak;
        return (this.inputOrderById.get(a.docId) ?? 0) - (this.inputOrderById.get(b.docId) ?? 0);
      });

      for (const item of rootItems) heap.push(item);

      while (heap.size > 0) {
        const current = heap.pop()!;
        sorted.push(current);

        for (const childId of this.childrenById.get(current.docId) ?? []) {
          parentCount.set(childId, (parentCount.get(childId) ?? 0) - 1);
          if ((parentCount.get(childId) ?? 0) === 0) {
            heap.push(this.byId.get(childId)!);
          }
        }
      }
    } else {
      const queue = rootItems;
      let head = 0;

      while (head < queue.length) {
        const current = queue[head++];
        sorted.push(current);

        for (const childId of this.childrenById.get(current.docId) ?? []) {
          parentCount.set(childId, (parentCount.get(childId) ?? 0) - 1);
          if ((parentCount.get(childId) ?? 0) === 0) {
            queue.push(this.byId.get(childId)!);
          }
        }
      }
    }

    if (sorted.length !== this.byId.size) {
      throw new Error("Topological sort failed. Graph may contain a cycle.");
    }

    return sorted;
  }

  edges(): DagEdge[] {
    const edges: DagEdge[] = [];
    for (const wo of this.byId.values()) {
      for (const parentId of wo.data.dependsOnWorkOrderIds) {
        edges.push({ from: parentId, to: wo.docId });
      }
    }
    return edges;
  }
}

export function buildWorkOrderDependencyDag(workOrders: WorkOrderDoc[]): WorkOrderDependencyDag {
  return new WorkOrderDependencyDag(workOrders);
}

class MinHeap<T> {
  private readonly items: T[] = [];
  private readonly compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this.compare = compare;
  }

  get size(): number {
    return this.items.length;
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) return undefined;

    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(this.items[i], this.items[parent]) >= 0) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      let best = i;

      if (left < this.items.length && this.compare(this.items[left], this.items[best]) < 0) {
        best = left;
      }
      if (right < this.items.length && this.compare(this.items[right], this.items[best]) < 0) {
        best = right;
      }
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const tmp = this.items[a];
    this.items[a] = this.items[b];
    this.items[b] = tmp;
  }
}
