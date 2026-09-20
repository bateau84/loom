# python-lint Assessment Contract

## Review criteria

Reviewer verifies lint evidence represents the effective Python codebase:

- Ruff/Flake8/Pylint/etc. version, target Python version, selected/ignored rules, per-file ignores, excludes, namespace/package discovery, and generated/vendor policy are explicit;
- formatter/linter/import-sorter/type-checker responsibilities are not conflated; a green formatter is not static correctness proof;
- `noqa`/disable comments are narrow and justified; broad file/category suppressions do not erase new defects silently;
- CI invocation covers relevant source/tests and exits non-zero on findings; caches/wrappers do not stale/ignore output;
- config changes are reviewed for rules silently removed/renamed by tool upgrades;
- auto-fix changes are checked for behavior/API/import side effects rather than trusted mechanically.

## Adjudication criteria

Critic seeks false-green configurations: blanket ignores, excluded changed paths, select lists that dropped important categories, tool-version drift, non-failing wrappers, or auto-fix that changes semantics. Compare changed files with effective config.

Block bypass of an accepted static gate or concealment of material defects. Preference among optional style rules is non-blocking.

## Scaling

Increase depth with config/tool upgrades, suppression breadth, monorepo/source-root complexity, security plugins, auto-fix scope, and reliance on lint as release evidence.