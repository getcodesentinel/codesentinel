type TarjanResult = {
  components: readonly (readonly string[])[];
};

export const runTarjanScc = (adjacencyById: ReadonlyMap<string, readonly string[]>): TarjanResult => {
  // SCC = group of nodes where every node can reach every other node through directed edges.
  // In this codebase, SCCs are used to detect dependency cycles before computing graph depth.
  let index = 0;
  const indices = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (nodeId: string): void => {
    indices.set(nodeId, index);
    lowLink.set(nodeId, index);
    index += 1;

    stack.push(nodeId);
    onStack.add(nodeId);

    const neighbors = adjacencyById.get(nodeId) ?? [];
    for (const nextId of neighbors) {
      if (!indices.has(nextId)) {
        strongConnect(nextId);
        const nodeLowLink = lowLink.get(nodeId);
        const nextLowLink = lowLink.get(nextId);
        if (nodeLowLink !== undefined && nextLowLink !== undefined && nextLowLink < nodeLowLink) {
          lowLink.set(nodeId, nextLowLink);
        }
        continue;
      }

      if (onStack.has(nextId)) {
        const nodeLowLink = lowLink.get(nodeId);
        const nextIndex = indices.get(nextId);
        if (nodeLowLink !== undefined && nextIndex !== undefined && nextIndex < nodeLowLink) {
          lowLink.set(nodeId, nextIndex);
        }
      }
    }

    const nodeLowLink = lowLink.get(nodeId);
    const nodeIndex = indices.get(nodeId);
    if (nodeLowLink === undefined || nodeIndex === undefined || nodeLowLink !== nodeIndex) {
      return;
    }

    const component: string[] = [];
    for (;;) {
      const popped = stack.pop();
      if (popped === undefined) {
        break;
      }

      onStack.delete(popped);
      component.push(popped);
      if (popped === nodeId) {
        break;
      }
    }

    component.sort((a, b) => a.localeCompare(b));
    components.push(component);
  };

  const nodeIds = [...adjacencyById.keys()].sort((a, b) => a.localeCompare(b));
  for (const nodeId of nodeIds) {
    if (!indices.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  components.sort((a, b) => {
    const firstA = a[0] ?? "";
    const firstB = b[0] ?? "";
    return firstA.localeCompare(firstB);
  });

  return { components };
};
