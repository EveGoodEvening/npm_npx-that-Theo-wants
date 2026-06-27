# `npm`&`npx` that Theo wants

Idea from Theo (https://x.com/theo/status/2069621429189161350 / https://www.youtube.com/watch?v=wEAb0x3wTRc). Note that Theo has no endorsement on this project (yet).

## Rationale - Improving `npm` (and `npx`)

### Problems with `npm`

1. **Security issues**: `npm` is a prime target for hackers. Every time a new exploit is discovered, `npm` adds another layer of restrictions, making it harder for legitimate developers to use. When Theo recently published a package, that ended up being the hardest part of the project.

2. **Publishing is too hard and irreversible**: If you accidentally publish the wrong version number, you can never undo it. Even a major project like **TanStack Query** got hit by this because of a typo in the version number. The latest React Query version number doesn’t match, and it can’t be rolled back because `npm` is afraid that old apps might lose dependencies and become impossible to rebuild.

3. **Lack of metadata and transparency**: When installing a package, you should be able to see much more information—was it obfuscated? Is the code readable? Is it open source? Who is behind it? Who published the previous version? What permissions does it need? Right now, you can’t see any of that.

4. **Name squatting**: Someone squatted on the `TanStack` package name. After **Tanner** refused to pay, that person sold the package to a shady company. `npm` did nothing about it. Theo thinks the `npm` team basically needs to be “completely cleaned out.”

5. **Security nightmare**: malicious packages are rampant, and typosquatting (for example, `is-odd` vs `is-0dd`) is basically impossible to prevent. Installing a malicious package feels exactly the same as installing a normal one, with no distinction at all.

### New `npm` features Theo wants

-  **Threshold-based unpublishing**: If a package has fewer than 100 installs or has been live for less than 5 hours, it should be possible to unpublish it.
-  **Paid auditing**: You could link an Anthropic API or a credit card, and let AI audit the diff for every release and return a security judgment.
-  **Security score**: Show permission info, security scores, recent maintainers, and so on at runtime.
-  **Private registry**: By default, publish to a private registry instead of the public one, so it’s easy to share with specific people.

### Improvements to `npx`

`npx` is the executable layer of `npm`, kind of like how a browser lets you visit different websites, while `npx` lets you run different code. But the current `npx` experience is awful—it only asks yes/no when you run a new package, and gives you no information to judge whether it’s safe.

What Theo wants:
-  Show the package size, author, security score, and runtime permissions
-  **This is especially important for AI agents**: if an agent’s `skill.md` contains an `npx` command and that package gets maliciously taken over, the agent could execute malicious code without knowing it. If `npx` could provide more information, the agent could decide for itself or warn the user.
-  **Micro-payment auditing**: after releasing open-source code, spend 50 cents to have an agent audit it on a third-party platform and return a security score. It can’t run on your own machine, because the result could be faked.
-  **Private registry integration**: be able to access unpublished packages in someone else’s environment via command line.

Theo said the cost of rebuilding `npm` is much lower than before. It wasn’t worth doing back then, but maybe it is now. Companies like Socket are already using AI to audit new `npm` releases and finding vulnerabilities faster than `npm` itself.


