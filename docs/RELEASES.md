# Standalone releases

This fork publishes standalone adapter archives through
[Release Standalone](../.github/workflows/release-standalone.yml), dispatched manually with the
version from `package.json`. The workflow runs `npm run check` and the tests, bundles the pinned
Claude Code runtime for Linux x64, and uploads the archive and `SHA256SUMS` as workflow artifacts.
With `publish` checked it also publishes them as the GitHub release `v<version>`.

Before dispatch, bump the version in `package.json` and `package-lock.json` and run `npm run check`,
`npm run build` and `npm run test:run`.
