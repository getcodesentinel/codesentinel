import type {
  GraphAnalysisSummary,
  RepositoryEvolutionSummary,
  WorkspaceEvolutionSummary,
  WorkspacePackage,
} from "@codesentinel/core";

const normalizePath = (pathValue: string): string => pathValue.replaceAll("\\", "/");

const findWorkspaceForFile = (
  filePath: string,
  workspaces: readonly WorkspacePackage[],
): WorkspacePackage | null => {
  let match: WorkspacePackage | null = null;
  for (const workspace of workspaces) {
    if (filePath === workspace.path || filePath.startsWith(`${workspace.path}/`)) {
      if (match === null || workspace.path.length > match.path.length) {
        match = workspace;
      }
    }
  }

  return match;
};

export const enrichEvolutionSummaryWithWorkspaces = (
  structural: GraphAnalysisSummary,
  evolution: RepositoryEvolutionSummary,
): RepositoryEvolutionSummary => {
  if (!evolution.available || structural.workspaces === undefined) {
    return evolution;
  }

  const workspaces = structural.workspaces;
  const workspaceByFile = new Map<string, WorkspacePackage>();
  const structuralWorkspacePaths = new Set(workspaces.map((workspace) => workspace.path));
  for (const file of evolution.files) {
    const workspace = findWorkspaceForFile(normalizePath(file.filePath), workspaces);
    if (workspace !== null) {
      workspaceByFile.set(normalizePath(file.filePath), workspace);
    }
  }

  const internalCouplingPairCountByWorkspace = new Map<string, number>();
  const incomingCouplingPairCountByWorkspace = new Map<string, number>();
  const outgoingCouplingPairCountByWorkspace = new Map<string, number>();

  for (const pair of evolution.coupling.pairs) {
    const fromWorkspace = workspaceByFile.get(normalizePath(pair.fileA));
    const toWorkspace = workspaceByFile.get(normalizePath(pair.fileB));
    if (fromWorkspace === undefined && toWorkspace === undefined) {
      continue;
    }

    if (fromWorkspace?.path === toWorkspace?.path && fromWorkspace !== undefined) {
      internalCouplingPairCountByWorkspace.set(
        fromWorkspace.path,
        (internalCouplingPairCountByWorkspace.get(fromWorkspace.path) ?? 0) + 1,
      );
      continue;
    }

    if (fromWorkspace !== undefined) {
      outgoingCouplingPairCountByWorkspace.set(
        fromWorkspace.path,
        (outgoingCouplingPairCountByWorkspace.get(fromWorkspace.path) ?? 0) + 1,
      );
    }

    if (toWorkspace !== undefined) {
      incomingCouplingPairCountByWorkspace.set(
        toWorkspace.path,
        (incomingCouplingPairCountByWorkspace.get(toWorkspace.path) ?? 0) + 1,
      );
    }
  }

  const workspaceSummaries: WorkspaceEvolutionSummary[] = workspaces
    .filter((workspace) => structuralWorkspacePaths.has(workspace.path))
    .map((workspace) => {
      const files = evolution.files
        .filter(
          (file) => workspaceByFile.get(normalizePath(file.filePath))?.path === workspace.path,
        )
        .sort((a, b) => a.filePath.localeCompare(b.filePath));
      const commitCount = files.reduce((sum, file) => sum + file.commitCount, 0);
      const recentCommitCount = files.reduce((sum, file) => sum + file.recentCommitCount, 0);
      const churnAdded = files.reduce((sum, file) => sum + file.churnAdded, 0);
      const churnDeleted = files.reduce((sum, file) => sum + file.churnDeleted, 0);
      const churnTotal = churnAdded + churnDeleted;
      const topAuthorShareByCommits =
        files.length === 0 ? 0 : Math.max(...files.map((file) => file.topAuthorShareByCommits));
      const busFactorByCommits =
        files.length === 0 ? 0 : Math.min(...files.map((file) => file.busFactorByCommits));
      const topHotspots = evolution.hotspots.filter(
        (hotspot) => workspaceByFile.get(normalizePath(hotspot.filePath))?.path === workspace.path,
      );

      return {
        name: workspace.name,
        path: workspace.path,
        kind: workspace.kind,
        fileCount: files.length,
        commitCount,
        churnAdded,
        churnDeleted,
        churnTotal,
        recentCommitCount,
        recentVolatility:
          commitCount === 0 ? 0 : Number((recentCommitCount / commitCount).toFixed(4)),
        topAuthorShareByCommits,
        busFactorByCommits,
        hotspotCount: topHotspots.length,
        topHotspots,
        internalCouplingPairCount: internalCouplingPairCountByWorkspace.get(workspace.path) ?? 0,
        incomingCouplingPairCount: incomingCouplingPairCountByWorkspace.get(workspace.path) ?? 0,
        outgoingCouplingPairCount: outgoingCouplingPairCountByWorkspace.get(workspace.path) ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.commitCount - a.commitCount ||
        b.churnTotal - a.churnTotal ||
        a.path.localeCompare(b.path),
    );

  return {
    ...evolution,
    workspaces: workspaceSummaries,
  };
};
