/**
 * Metrics collection (Section 25.2).
 *
 * Simple in-memory metrics tracker for API latency, worker jobs,
 * analysis failures, risk decisions, policy blocks, audit provider
 * errors, and signature failures.
 */
export type MetricName =
  | 'api_latency_ms'
  | 'worker_job_latency_ms'
  | 'analysis_failures'
  | 'risk_decisions'
  | 'policy_blocks'
  | 'audit_provider_errors'
  | 'signature_failures';

interface CounterEntry {
  value: number;
  labels: Record<string, string>;
}

interface HistogramEntry {
  count: number;
  sum: number;
  min: number;
  max: number;
  labels: Record<string, string>;
}

/**
 * In-memory metrics registry with counters and histograms.
 */
export class MetricsRegistry {
  private counters = new Map<string, CounterEntry>();
  private histograms = new Map<string, HistogramEntry>();

  private labelKey(labels: Record<string, string>): string {
    return Object.entries(labels).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join(',');
  }

  incCounter(name: MetricName, labels: Record<string, string> = {}, by = 1): void {
    const key = `${name}:${this.labelKey(labels)}`;
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += by;
    } else {
      this.counters.set(key, { value: by, labels });
    }
  }

  observeHistogram(name: MetricName, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}:${this.labelKey(labels)}`;
    const existing = this.histograms.get(key);
    if (existing) {
      existing.count++;
      existing.sum += value;
      existing.min = Math.min(existing.min, value);
      existing.max = Math.max(existing.max, value);
    } else {
      this.histograms.set(key, { count: 1, sum: value, min: value, max: value, labels });
    }
  }

  /** Export metrics in Prometheus text format. */
  toPrometheus(): string {
    const lines: string[] = [];

    // Counters.
    const counterNames = new Set<string>();
    for (const key of this.counters.keys()) {
      const name = key.split(':')[0]!;
      counterNames.add(name);
    }
    for (const name of counterNames) {
      lines.push(`# TYPE ${name} counter`);
      for (const [key, entry] of this.counters) {
        if (key.startsWith(name + ':')) {
          const labelStr = Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',');
          lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${entry.value}`);
        }
      }
    }

    // Histograms (summary format).
    const histogramNames = new Set<string>();
    for (const key of this.histograms.keys()) {
      const name = key.split(':')[0]!;
      histogramNames.add(name);
    }
    for (const name of histogramNames) {
      lines.push(`# TYPE ${name} summary`);
      for (const [key, entry] of this.histograms) {
        if (key.startsWith(name + ':')) {
          const labelStr = Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',');
          const labels = labelStr ? `{${labelStr}}` : '';
          lines.push(`${name}_count${labels} ${entry.count}`);
          lines.push(`${name}_sum${labels} ${entry.sum}`);
          lines.push(`${name}_min${labels} ${entry.min}`);
          lines.push(`${name}_max${labels} ${entry.max}`);
        }
      }
    }

    return lines.join('\n');
  }

  /** Export metrics as JSON. */
  toJSON(): { counters: Record<string, number>; histograms: Record<string, { count: number; sum: number; min: number; max: number }> } {
    const counters: Record<string, number> = {};
    for (const [key, entry] of this.counters) {
      counters[key] = entry.value;
    }
    const histograms: Record<string, { count: number; sum: number; min: number; max: number }> = {};
    for (const [key, entry] of this.histograms) {
      histograms[key] = { count: entry.count, sum: entry.sum, min: entry.min, max: entry.max };
    }
    return { counters, histograms };
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

/** Global metrics registry singleton. */
export const metrics = new MetricsRegistry();
