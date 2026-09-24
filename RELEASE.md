# Release

First proposed tag: **v0.1.0**.

Pushing a `v*.*.*` tag (for example `v0.1.0`) runs [`.github/workflows/publish.yml`](.github/workflows/publish.yml). That workflow builds this repo's `Dockerfile`, pushes it to GHCR, and opens a GitHub Release for the same tag.

Published image:

```text
ghcr.io/recognizeyourprivilege/seraframe
```

For tag `v0.1.0` the workflow also pushes `0.1.0`, `0.1`, and `latest`. Pre-release tags such as `v0.1.0-rc.1` are pushed under that tag name and do not move `latest`.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Pull and run the published image:

```bash
docker pull ghcr.io/recognizeyourprivilege/seraframe:v0.1.0

docker run --rm -p 18880:18880 \
  -e SERAFRAME_ADMIN_PASSWORD='change-me' \
  -v seraframe-data:/data \
  ghcr.io/recognizeyourprivilege/seraframe:v0.1.0
```

Open `http://127.0.0.1:18880/` and sign in with that password. The image serves the client UI at `/`.

`SERAFRAME_ADMIN_PASSWORD` is required. The process exits if it is missing or empty. There is no default password.

`SERAFRAME_SECRET_KEY` is optional.

- Unset or empty: on first start the process generates a key, writes `$SERAFRAME_DATA_DIR/secret_key` (mode `0600`), and reuses that file on later starts. Keep the data volume.
- Set: that value is used for the process. It must be at least 32 bytes. The persisted file is not created, read, or overwritten.

A later start with the variable unset uses the file if it exists. That file can differ from a key previously supplied only through the environment. SFTP secrets encrypted with one key cannot be decrypted with the other.

After the first push, confirm the package visibility under GitHub Packages if the image should be pullable without authentication.
