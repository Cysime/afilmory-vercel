# Remote artifact cache security

The optional Git cache contains the site manifest and generated thumbnails. In
`exact` mode it can also contain a geocoding cache whose keys reveal precise
coordinates. Treat the entire repository as sensitive and private. It is an
acceleration layer, not a backup and never a photo storage backend.

## Safe setup

1. Create a **private** repository used only for Afilmory build artifacts. Never point
   `REPO_URL` at the Afilmory source repository.
2. Create the dedicated `afilmory-cache` branch. Protected source branch names
   such as `main` and `master` are rejected.
3. Use a fine-grained token restricted to that one repository with only
   **Contents: read and write**. No organization, workflow, package, issue, or
   source-repository permission is needed.
4. Store the token in the deployment platform's encrypted secret store as
   `REPO_TOKEN`; never put it in a URL or commit it.

Normal saves append a commit and never rewrite history. Repositories with very
large thumbnail histories can opt into compaction with
`REPO_CACHE_ALLOW_HISTORY_REWRITE=true`. Compaction creates a single orphan
commit and pushes it with a lease against the exact fetched commit, so concurrent
updates fail instead of being overwritten. This setting is destructive to the
cache branch and should never be enabled for a branch containing source code.

Restores treat repository content as untrusted: symbolic links, nested or
unexpected thumbnail names, oversized files, malformed JSON, and mismatched media
signatures are rejected before the existing local artifact is replaced.

`geocoding-cache.json` crosses the repository boundary only when
`PHOTO_LOCATION_MODE=exact`. Both `coarse` and `strip` ignore the remote copy and
delete any local legacy exact cache during restore; a successful save also stages
deletion of the remote legacy file. This deliberately trades geocoder cache hits
for a hard guarantee that exact coordinate keys cannot survive a privacy-mode
change.
