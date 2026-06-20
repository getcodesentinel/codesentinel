import type {
  GraphAnalysisSummary,
  RepositoryEvolutionSummary,
  WorkspaceEvolutionSummary,
} from "@codesentinel/core";
import { createWorkspaceByFile, normalizeWorkspacePath } from "@codesentinel/core";

export const enrichEvolutionSummaryWithWorkspaces = (
  structural: GraphAnalysisSummary,
  evolution: RepositoryEvolutionSummary,
): RepositoryEvolutionSummary => {
  if (!evolution.available || structural.workspaces === undefined) {
    return evolution;
  }

  const workspaces = structural.workspaces;
  const workspaceByFile = createWorkspaceByFile(
    evolution.files.map((file) => normalizeWorkspacePath(file.filePath)),
    workspaces,
  );
  const structuralWorkspacePaths = new Set(workspaces.map((workspace) => workspace.path));

  const internalCouplingPairCountByWorkspace = new Map<string, number>();
  const incomingCouplingPairCountByWorkspace = new Map<string, number>();
  const outgoingCouplingPairCountByWorkspace = new Map<string, number>();

  for (const pair of evolution.coupling.pairs) {
    const fromWorkspace = workspaceByFile.get(normalizeWorkspacePath(pair.fileA));
    const toWorkspace = workspaceByFile.get(normalizeWorkspacePath(pair.fileB));
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
          (file) =>
            workspaceByFile.get(normalizeWorkspacePath(file.filePath))?.path === workspace.path,
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
        (hotspot) =>
          workspaceByFile.get(normalizeWorkspacePath(hotspot.filePath))?.path === workspace.path,
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
