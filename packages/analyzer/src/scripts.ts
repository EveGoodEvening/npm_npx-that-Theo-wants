import {
  LifecycleScriptFinding,
  ScriptKind,
  type LifecycleScriptFinding as LifecycleScriptFindingType,
} from '@safe-npm/core-types';

/**
 * Script analyzer (design 4.4). Inspects `package.json` lifecycle scripts
 * without executing them and flags risky patterns.
 */

const LIFECYCLE_KINDS: ReadonlyArray<ScriptKind> = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
];

const NETWORK_TOOLS = ['curl', 'wget', 'nc', 'ssh', 'scp'] as const;
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'npx', 'pnpx', 'bun'] as const;
const SHELL_METACHARS = /[;&|`$<>]/;

export function analyzeScripts(
  scripts: Record<string, string>,
  hasBindingGyp = false,
): LifecycleScriptFindingType[] {
  const findings: LifecycleScriptFindingType[] = [];
  for (const kind of LIFECYCLE_KINDS) {
    const command = scripts[kind];
    if (!command) continue;
    const flags = flagsForCommand(command, kind, hasBindingGyp);
    findings.push(LifecycleScriptFinding.parse({ kind, command, flags }));
  }
  return findings;
}

function flagsForCommand(
  command: string,
  kind: ScriptKind,
  hasBindingGyp: boolean,
): LifecycleScriptFindingType['flags'] {
  const flags: Array<LifecycleScriptFindingType['flags'][number]> = [];
  if (SHELL_METACHARS.test(command)) flags.push('shell_metacharacters');
  for (const tool of NETWORK_TOOLS) {
    if (containsWord(command, tool)) {
      flags.push('network_tool');
      break;
    }
  }
  for (const pm of PACKAGE_MANAGERS) {
    if (containsWord(command, pm)) {
      flags.push('package_manager');
      break;
    }
  }
  if (hasBindingGyp && (kind === 'install' || kind === 'postinstall')) {
    if (containsWord(command, 'node-gyp') || command.includes('binding.gyp')) {
      flags.push('node_gyp_native_build');
    } else {
      // node-gyp is implicitly invoked by npm for packages with binding.gyp.
      flags.push('node_gyp_native_build');
    }
  }
  return flags;
}

function containsWord(haystack: string, word: string): boolean {
  const re = new RegExp(`(^|[^\\w-])${escapeRegExp(word)}([^\\w-]|$)`, 'i');
  return re.test(haystack);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
