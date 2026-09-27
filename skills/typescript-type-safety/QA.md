# typescript-type-safety Quality Assurance

Critic-only adversarial contract. Assume competent production and normal review have already occurred; attack residual false confidence that can survive an apparently clean strict typecheck.

## QA criteria

Critic attacks the seams where TypeScript's model can be locally correct while the runtime or composed program is still wrong:

- route an object with extra fields through an intermediate variable, generic, spread, or helper before assignment to test whether code mistakes excess-property checking for an exact-object guarantee;
- substitute a different domain value with the same structural shape and test whether supposedly distinct IDs, tokens, handles, or states can be mixed without the compiler noticing;
- treat third-party or generated declaration files as potentially wrong evidence: falsify a declared return shape at runtime and verify that trust-sensitive boundaries do not rely on `.d.ts` claims alone;
- mutate a value through another writable alias after a readonly view, narrowing decision, or validation result has been established and see whether the assumed invariant can become stale;
- exercise schema defaults, coercions, transforms, stripping/passthrough of unknown keys, and version skew so the runtime value produced by validation is compared with the static type consumers believe they received;
- introduce duplicate package/schema versions or ambient/global declaration augmentation and check whether two modules compile against different meanings of the same apparent contract;
- inject a runtime variant that is outside a closed compile-time union and verify that an exhaustive switch is protected by the boundary that creates the union rather than trusted as runtime validation;
- compile representative external consumers under the actual project-reference and declaration-output configuration, especially when `skipLibCheck`, generated declarations, or library boundaries can hide incompatibility.

Block when a load-bearing guarantee exists only inside TypeScript's model and no boundary preserves that guarantee in the composed runtime. Do not require nominal or exact typing where structural compatibility and additional properties are intentionally acceptable.

## QA depth

Increase depth for public libraries, generated clients, schema-driven APIs, branded identities, declaration files, cross-package types, runtime state machines, plugin/tool payloads, and refactors that rely on compiler success as broad mechanical proof.
