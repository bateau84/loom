# typescript-common-practice Quality Assurance

Critic-only adversarial contract. Assume competent TypeScript production and review have already occurred; attack false confidence from configuration and integration boundaries.

## QA criteria

Critic checks whether the green TypeScript signal covers what everyone assumes it covers:

- changed source or generated declarations are not silently excluded by tsconfig include/exclude, project references, build entrypoints, or test-only configs;
- CI and local scripts resolve the same pinned TypeScript/runtime/module assumptions;
- a declaration/public API remains usable from a real consumer rather than only inside the defining module;
- runtime schema/generated types and hand-authored types cannot drift into two competing sources of truth;
- barrel/re-export structure does not hide duplicate symbols, cycles, or a stale compatibility surface;
- no broad compiler option, ambient declaration, or global type augmentation makes an otherwise invalid core path appear safe.

Block when the claimed TypeScript verification does not actually cover the shipped source/API. Do not require maximal compiler strictness beyond the accepted repository contract.

## QA depth

Increase depth for library/public API changes, tsconfig/project-reference edits, generated declaration pipelines, ESM/CJS or bundler transitions, and changes that add ambient/global types.
