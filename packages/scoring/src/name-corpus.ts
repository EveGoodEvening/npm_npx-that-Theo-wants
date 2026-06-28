/**
 * Popular package corpus (design 13.1).
 *
 * A list of popular npm package names used for typosquat detection.
 * In production, this would be updated from npm download counts.
 */

export interface PopularPackage {
  name: string;
  /** Popularity rank (1 = most popular). */
  rank: number;
  /** Weekly download count (approximate). */
  weeklyDownloads: number;
}

/**
 * Default fixture of popular packages for MVP.
 * In production, this would be loaded from a JSON file or database table
 * updated from npm download counts.
 */
export const DEFAULT_POPULAR_PACKAGES: PopularPackage[] = [
  { name: 'react', rank: 1, weeklyDownloads: 25_000_000 },
  { name: 'lodash', rank: 2, weeklyDownloads: 24_000_000 },
  { name: 'express', rank: 3, weeklyDownloads: 22_000_000 },
  { name: 'axios', rank: 4, weeklyDownloads: 20_000_000 },
  { name: 'chalk', rank: 5, weeklyDownloads: 18_000_000 },
  { name: 'commander', rank: 6, weeklyDownloads: 17_000_000 },
  { name: 'debug', rank: 7, weeklyDownloads: 16_000_000 },
  { name: 'typescript', rank: 8, weeklyDownloads: 15_000_000 },
  { name: 'vue', rank: 9, weeklyDownloads: 14_000_000 },
  { name: 'angular', rank: 10, weeklyDownloads: 13_000_000 },
  { name: 'is-odd', rank: 50, weeklyDownloads: 5_000_000 },
  { name: 'is-number', rank: 51, weeklyDownloads: 4_500_000 },
  { name: 'left-pad', rank: 52, weeklyDownloads: 4_000_000 },
  { name: 'mkdirp', rank: 53, weeklyDownloads: 3_500_000 },
  { name: 'request', rank: 54, weeklyDownloads: 3_000_000 },
];

export class PopularPackageCorpus {
  private packages: Map<string, PopularPackage>;

  constructor(packages: PopularPackage[] = DEFAULT_POPULAR_PACKAGES) {
    this.packages = new Map(packages.map((p) => [p.name.toLowerCase(), p]));
  }

  /** Check if a package name is in the corpus. */
  isPopular(name: string): boolean {
    return this.packages.has(name.toLowerCase());
  }

  /** Get a package by name. */
  get(name: string): PopularPackage | undefined {
    return this.packages.get(name.toLowerCase());
  }

  /** Get all popular packages. */
  list(): PopularPackage[] {
    return [...this.packages.values()].sort((a, b) => a.rank - b.rank);
  }

  /** Add or update a package in the corpus. */
  upsert(pkg: PopularPackage): void {
    this.packages.set(pkg.name.toLowerCase(), pkg);
  }

  /** Scheduled update placeholder (design 13.1). */
  async scheduledUpdate(): Promise<void> {
    // TODO: Fetch latest download counts from npm API.
  }
}
