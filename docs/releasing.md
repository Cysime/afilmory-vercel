# Release process

Afilmory uses SemVer for the repository release. Internal private workspace
package versions may move independently, but a release tag describes the exact
source used by the application and must remain reproducible from the lockfile.

1. Resolve or explicitly defer every item under `CHANGELOG.md`'s Unreleased
   section.
2. Run `pnpm install --frozen-lockfile`, `pnpm contracts`, `pnpm lint`,
   `pnpm format:check`, `pnpm type-check`, `pnpm test:coverage`,
   `pnpm coverage:check:partitions`, `pnpm deploy:smoke`, and relevant browser
   smoke tests.
3. Run `pnpm sbom`; attach `artifacts/sbom.cdx.json` to the GitHub release.
4. Move Unreleased entries under a dated `x.y.z` heading, update comparison
   links, and commit the release metadata.
5. Confirm the production footer resolves to that clean commit. Modified-source
   releases must publish an exact source archive and set
   `AFILMORY_CORRESPONDING_SOURCE_URL`; never point at a commit that omits the
   shipped changes.
6. Create an annotated `vX.Y.Z` tag from the reviewed commit and publish GitHub
   release notes from the changelog.
7. Start a fresh empty Unreleased section immediately after release.

Hotfix releases follow the same gates. Never create a release from an uncommitted
working tree or with a non-frozen dependency install.
