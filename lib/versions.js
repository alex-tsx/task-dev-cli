import semver from 'semver';

export function taskException(version, spec) {
  const parsed = semver.parse(version);
  const range = extractRange(spec);
  if (!parsed?.prerelease.length || range === null) return null;

  // Explicit prerelease requirements keep their usual meaning (including task/revision pins).
  if (semver.satisfies(parsed, range)) return { version, range, comparableVersion: parsed.version };
  if (/\d+\.\d+\.\d+-[\da-z]/i.test(range)) return null;

  const comparableVersion = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return semver.satisfies(comparableVersion, range) ? { version, range, comparableVersion } : null;
}

export function extractRange(spec) {
  if (typeof spec !== 'string') return null;
  const range = (spec.match(/#semver:(.+)$/)?.[1] ?? spec).trim();
  return semver.validRange(range) === null ? null : range;
}

export function approvedConflict(output, localPackages = []) {
  // Warnings describe conflicts npm already tolerated, rather than the fatal conflict to approve.
  const report = output
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/^npm (?:WARN|warn)\b.*(?:\r?\n|$)/gm, '')
    .replace(/^npm (?:ERR!|ERROR|error|notice)[^\S\r\n]*/gm, '')
    .replaceAll('\r\n', '\n');
  if (!/\bERESOLVE\b/.test(report)) return null;
  if ((report.match(/^Could not resolve dependency:/gm) ?? []).length !== 1) return null;
  if ((report.match(/^Conflicting peer dependency:/gm) ?? []).length > 1) return null;

  const unresolved = report.split(/^Could not resolve dependency:\s*\n/m)[1];
  const peer = unresolved?.match(/^peer(?:Optional)? (\S+)@"([^"]+)" from (\S+)@(\S+)/m);
  if (!peer) return null;
  const [, name, spec, requester] = peer;
  const found = report.match(/^Found: (\S+)@(\S+)/m);
  const conflicting = report.match(/^Conflicting peer dependency: (\S+)@(\S+)/m);
  const candidate = found?.[1] === name ? found : conflicting?.[1] === name ? conflicting : null;
  // npm sometimes reports a new file: dependency as `undefined` before reading its manifest.
  // Only an explicitly supplied, preflighted local package may fill that gap.
  const version = candidate?.[2] === 'undefined'
    ? localPackages.find(pkg => pkg.name === name)?.version
    : candidate?.[2];
  const exception = taskException(version, spec);
  return exception ? { name, requester, ...exception } : null;
}
