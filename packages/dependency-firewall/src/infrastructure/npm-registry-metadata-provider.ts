import type { DependencyMetadata, DependencyMetadataProvider } from "../domain/types.js";

type NpmPackagePayload = {
  time?: Record<string, string>;
  maintainers?: Array<{ name?: string; email?: string }>;
};

type NpmDownloadsPayload = {
  downloads?: number;
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const round4 = (value: number): number => Number(value.toFixed(4));

const parseDate = (iso: string | undefined): number | null => {
  if (iso === undefined) {
    return null;
  }

  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
};

export class NpmRegistryMetadataProvider implements DependencyMetadataProvider {
  private readonly cache = new Map<string, DependencyMetadata | null>();

  private async fetchWeeklyDownloads(name: string): Promise<number | null> {
    const encodedName = encodeURIComponent(name);
    const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodedName}`);
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NpmDownloadsPayload;
    const downloads = payload.downloads;
    if (typeof downloads !== "number" || Number.isNaN(downloads) || downloads < 0) {
      return null;
    }

    return Math.floor(downloads);
  }

  async getMetadata(name: string, version: string): Promise<DependencyMetadata | null> {
    const key = `${name}@${version}`;
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }

    try {
      const encodedName = encodeURIComponent(name);
      const response = await fetch(`https://registry.npmjs.org/${encodedName}`);
      if (!response.ok) {
        this.cache.set(key, null);
        return null;
      }

      const payload = (await response.json()) as NpmPackagePayload;
      const timeEntries = payload.time ?? {};

      const publishDates = Object.entries(timeEntries)
        .filter(([tag]) => tag !== "created" && tag !== "modified")
        .map(([, date]) => parseDate(date))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);

      const modifiedAt = parseDate(timeEntries["modified"]);
      const now = Date.now();
      const daysSinceLastRelease =
        modifiedAt === null ? null : Math.max(0, round4((now - modifiedAt) / ONE_DAY_MS));

      let releaseFrequencyDays: number | null = null;
      if (publishDates.length >= 2) {
        const totalIntervals = publishDates.length - 1;
        let sum = 0;
        for (let i = 1; i < publishDates.length; i += 1) {
          const current = publishDates[i];
          const previous = publishDates[i - 1];
          if (current !== undefined && previous !== undefined) {
            sum += current - previous;
          }
        }

        releaseFrequencyDays = round4(sum / totalIntervals / ONE_DAY_MS);
      }

      const maintainers = payload.maintainers ?? [];
      const maintainerCount = maintainers.length > 0 ? maintainers.length : null;
      const weeklyDownloads = await this.fetchWeeklyDownloads(name).catch(() => null);

      const metadata: DependencyMetadata = {
        name,
        version,
        weeklyDownloads,
        maintainerCount,
        releaseFrequencyDays,
        daysSinceLastRelease,
        repositoryActivity30d: null,
        busFactor: null,
      };

      this.cache.set(key, metadata);
      return metadata;
    } catch {
      this.cache.set(key, null);
      return null;
    }
  }
}
