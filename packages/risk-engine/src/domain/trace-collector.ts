import type { RiskTrace, TargetTrace } from "@codesentinel/core";

export interface TraceCollector {
  record(target: TargetTrace): void;
  build(): RiskTrace | undefined;
}

class NoopTraceCollector implements TraceCollector {
  record(_target: TargetTrace): void {}

  build(): undefined {
    return undefined;
  }
}

class RecordingTraceCollector implements TraceCollector {
  private readonly targets: TargetTrace[] = [];

  record(target: TargetTrace): void {
    this.targets.push(target);
  }

  build(): RiskTrace {
    const orderedTargets = [...this.targets].sort((a, b) => {
      if (a.targetType !== b.targetType) {
        return a.targetType.localeCompare(b.targetType);
      }

      if (b.totalScore !== a.totalScore) {
        return b.totalScore - a.totalScore;
      }

      return a.targetId.localeCompare(b.targetId);
    });

    return {
      schemaVersion: "1",
      contributionTolerance: 0.0001,
      targets: orderedTargets,
    };
  }
}

const noopCollectorSingleton = new NoopTraceCollector();

export const createTraceCollector = (enabled: boolean): TraceCollector =>
  enabled ? new RecordingTraceCollector() : noopCollectorSingleton;
