import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics.js';

describe('MetricsRegistry', () => {
  it('increments counters', () => {
    const reg = new MetricsRegistry();
    reg.incCounter('analysis_failures');
    reg.incCounter('analysis_failures');
    reg.incCounter('policy_blocks', { reason: 'min_score' });
    reg.incCounter('policy_blocks', { reason: 'min_score' });
    reg.incCounter('policy_blocks', { reason: 'caution_tier' });

    const json = reg.toJSON();
    expect(json.counters['analysis_failures:']).toBe(2);
    expect(json.counters['policy_blocks:reason=min_score']).toBe(2);
    expect(json.counters['policy_blocks:reason=caution_tier']).toBe(1);
  });

  it('observes histograms', () => {
    const reg = new MetricsRegistry();
    reg.observeHistogram('api_latency_ms', 100, { route: '/v1/packages' });
    reg.observeHistogram('api_latency_ms', 200, { route: '/v1/packages' });
    reg.observeHistogram('api_latency_ms', 50, { route: '/v1/packages' });

    const json = reg.toJSON();
    const key = 'api_latency_ms:route=/v1/packages';
    expect(json.histograms[key].count).toBe(3);
    expect(json.histograms[key].sum).toBe(350);
    expect(json.histograms[key].min).toBe(50);
    expect(json.histograms[key].max).toBe(200);
  });

  it('exports Prometheus format', () => {
    const reg = new MetricsRegistry();
    reg.incCounter('risk_decisions', { tier: 'good' });
    reg.observeHistogram('api_latency_ms', 100, { route: '/test' });

    const prom = reg.toPrometheus();
    expect(prom).toContain('# TYPE risk_decisions counter');
    expect(prom).toContain('risk_decisions{tier="good"} 1');
    expect(prom).toContain('# TYPE api_latency_ms summary');
    expect(prom).toContain('api_latency_ms_count{route="/test"} 1');
  });

  it('resets metrics', () => {
    const reg = new MetricsRegistry();
    reg.incCounter('analysis_failures');
    reg.observeHistogram('api_latency_ms', 100);
    reg.reset();
    const json = reg.toJSON();
    expect(Object.keys(json.counters)).toHaveLength(0);
    expect(Object.keys(json.histograms)).toHaveLength(0);
  });
});
