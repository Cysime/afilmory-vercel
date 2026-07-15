# Licensing map

`LICENSE` is the authoritative dual-track license. `ANL-MANIFEST` makes its
path-level classification machine-readable and removes ambiguity around packages
whose directory name alone does not determine their role.

- Reusable packages (`build-assets`, `media`, `schema`, `ui`, and
  `webgl-viewer`) are Library Code under MIT.
- The web app, Builder, build/deploy scripts, project configuration, and project
  tooling are Project Code under AGPL-3.0-or-later plus the additional terms in
  LICENSE Section 4.
- Documentation and non-code media use CC BY 4.0 unless stated otherwise;
  trademarks and brand elements remain excluded.

Package `license` fields must agree with the manifest. MIT packages use the MIT
SPDX identifier. Project packages use `SEE LICENSE IN ../../LICENSE` because a
plain AGPL identifier would omit the Section 4 terms.

New files inherit the classification of their nearest mapped directory. Add a
file-level `SPDX-License-Identifier` only when intentionally overriding that
classification, and update `ANL-MANIFEST` when adding a new top-level code area.
This policy uses SPDX identifiers where they accurately express the terms, but
the repository does not claim full REUSE conformance because Project Code has an
additional license term documented in the repository license.

The web footer links to the fork and exact source revision used for clean
builds. CI/Vercel fails closed when Project Code is dirty or no exact revision
is available. An intentional modified-source deployment must publish its exact
Corresponding Source and set `AFILMORY_CORRESPONDING_SOURCE_URL` to that public
archive/tree; a repository URL for an older commit is not sufficient.

This guide is descriptive and is not legal advice.
