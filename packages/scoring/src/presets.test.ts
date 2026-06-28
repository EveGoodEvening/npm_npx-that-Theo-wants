import { describe, expect, it } from 'vitest';
import { RELAXED_PRESET, DEFAULT_HUMAN_PRESET, STRICT_PRESET, AGENT_PRESET, CI_PRESET, PRESETS, getPreset, listPresets } from './presets.js';

describe('presets', () => {
  it('exports all 5 presets', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(['agent', 'ci', 'default-human', 'relaxed', 'strict']);
  });

  it('relaxed preset allows almost everything', () => {
    expect(RELAXED_PRESET.install.minimumScore).toBe(20);
    expect(RELAXED_PRESET.install.allowInstallScripts).toBe(true);
    expect(RELAXED_PRESET.install.allowNonRegistrySources).toBe(true);
    expect(RELAXED_PRESET.install.requireExactVersion).toBe(false);
    expect(RELAXED_PRESET.install.disallowLatestTag).toBe(false);
  });

  it('default-human preset is balanced', () => {
    expect(DEFAULT_HUMAN_PRESET.install.minimumScore).toBe(55);
    expect(DEFAULT_HUMAN_PRESET.install.allowInstallScripts).toBe(true);
    expect(DEFAULT_HUMAN_PRESET.install.requireExactVersion).toBe(false);
    expect(DEFAULT_HUMAN_PRESET.install.disallowLatestTag).toBe(false);
  });

  it('strict preset is restrictive', () => {
    expect(STRICT_PRESET.install.minimumScore).toBe(85);
    expect(STRICT_PRESET.install.allowInstallScripts).toBe(false);
    expect(STRICT_PRESET.install.requireExactVersion).toBe(true);
    expect(STRICT_PRESET.install.disallowLatestTag).toBe(true);
    expect(STRICT_PRESET.install.requirePermissionEnforcement).toBe(true);
  });

  it('agent preset blocks latest and requires exact versions', () => {
    expect(AGENT_PRESET.install.minimumScore).toBe(75);
    expect(AGENT_PRESET.install.requireExactVersion).toBe(true);
    expect(AGENT_PRESET.install.disallowLatestTag).toBe(true);
    expect(AGENT_PRESET.install.requirePermissionEnforcement).toBe(true);
    expect(AGENT_PRESET.exec.requireExactVersion).toBe(true);
    expect(AGENT_PRESET.exec.disallowLatestTag).toBe(true);
  });

  it('ci preset requires exact versions but allows install scripts', () => {
    expect(CI_PRESET.install.minimumScore).toBe(70);
    expect(CI_PRESET.install.requireExactVersion).toBe(true);
    expect(CI_PRESET.install.disallowLatestTag).toBe(true);
    expect(CI_PRESET.install.allowInstallScripts).toBe(true);
  });

  it('getPreset returns preset by name', () => {
    expect(getPreset('relaxed')).toBe(RELAXED_PRESET);
    expect(getPreset('strict')).toBe(STRICT_PRESET);
    expect(getPreset('nonexistent')).toBeUndefined();
  });

  it('listPresets returns all preset names', () => {
    const names = listPresets();
    expect(names).toContain('relaxed');
    expect(names).toContain('default-human');
    expect(names).toContain('strict');
    expect(names).toContain('agent');
    expect(names).toContain('ci');
    expect(names.length).toBe(5);
  });
});
