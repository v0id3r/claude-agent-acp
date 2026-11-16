# Jaz standalone releases

Jaz publishes standalone adapter archives through
[Release Standalone](../.github/workflows/release-standalone.yml).
The workflow is dispatched manually with the fork version from `package.json`.
It runs the adapter tests, bundles the pinned Claude runtime for Linux x64,
and uploads the platform archive and SHA256SUMS as workflow artifacts. When
`publish` is checked, it also publishes them under `v<version>`.
The Linux x64 archive contains the adapter and its companion Claude executable.

Before dispatch, run `npm run check`, `npm run build`, and `npm run test:run`,
and complete native-parity validation for the pinned Claude runtime.
Update Jaz's adapter manifest only after the release assets are available and verified.
