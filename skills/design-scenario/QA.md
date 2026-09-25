# design-scenario Quality Assurance

## QA criteria

- Walk the scenario as a distracted, mistaken, interrupted, or partially informed person rather than the ideal user.
- Find states where the scenario silently assumes knowledge the person has not been given.
- Attack failure paths that end in "shows an error" without a recoverable or truthful human outcome.
- Search for a scenario whose success is really a backend event the person cannot perceive.
- Check whether the scenario presupposes a specific UI pattern and thereby hides alternative designs.
- Look for missing abandonment/re-entry behavior when interruption is realistic.
- Check whether a mock/future capability is being used to make the journey appear complete.

## QA depth

Increase depth where the scenario is intended to constrain many flows or serve as acceptance evidence.
