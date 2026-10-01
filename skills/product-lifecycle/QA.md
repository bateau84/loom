# Product Lifecycle QA

For Critic when apparently complete product evidence may hide a lifecycle failure.

## QA criteria

- **Clean-room illusion:** remove implicit developer state, cached credentials, seeded data, or undocumented manual setup from the claimed supported starting condition. Can the intended user still reach the first useful result?
- **Recovery composition:** consider a material interruption or partial write. Does the proposed recovery preserve the accepted data/outcome, or merely restore process availability?
- **Change-path substitution:** could fresh-install tests pass while the supported upgrade/configuration migration breaks existing users or state? Consider mixed versions only when that deployment pattern is in scope.
- **Unusable escape path:** could backup, rollback, export, or cleanup appear successful while leaving users unable to restore, continue, or safely leave as promised?
- **Unowned operation:** can a failure be detected but nobody with the intended permissions or information can act? Look for costs or responsibilities shifted to an unstated operator.

Use realistic conditions within accepted scope. State whether the result is an observed defect, a contradiction, or missing proof. Do not demand unsupported deployment modes, universal zero-downtime upgrades, telemetry, or restoration guarantees the product never accepted.
