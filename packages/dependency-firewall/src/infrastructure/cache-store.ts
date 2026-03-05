export type CacheEntry<T> = {
  value: T;
  fetchedAtMs: number;
};

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(key: string, entry: CacheEntry<T>): Promise<void>;
}
