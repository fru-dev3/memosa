# Releasing Memosa (direct-download `.dmg`)

The App Store build ships through Xcode/Transporter as usual. This doc covers the
**open-source direct download**: pushing a `v*` tag makes
`.github/workflows/release.yml` build, sign, notarize, and publish a `.dmg` to
GitHub Releases — exposed to the website as
`releases/latest/download/Memosa-mac-arm64.dmg`.

## One-time: signing secrets

The release works without these (it just produces an **unsigned** `.dmg` that
users must right-click → Open). To ship a clean, notarized download, add these
repo secrets (**Settings → Secrets and variables → Actions**):

| Secret | What it is |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password you set when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TXN399AHT5)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an **app-specific password** (appleid.apple.com → Sign-In & Security) |
| `APPLE_TEAM_ID` | `TXN399AHT5` |
| `KEYCHAIN_PASSWORD` | any string (a temp keychain is created on the runner) |

### Getting the Developer ID Application certificate

Your App Store cert is **not** the right one — you need a **Developer ID
Application** cert (same Apple Developer account, different type):

1. Apple Developer → Certificates → **+** → **Developer ID Application** → follow
   the CSR steps (Keychain Access → Certificate Assistant → Request from a CA).
2. Download and double-click to install into your login keychain.
3. Export it as `.p12`: Keychain Access → right-click the cert → Export →
   set a password (that's `APPLE_CERTIFICATE_PASSWORD`).
4. base64 it for the secret:
   ```bash
   base64 -i DeveloperID_Application.p12 | pbcopy   # paste into APPLE_CERTIFICATE
   ```

> If `security import` fails on the runner, re-export the `.p12` in the legacy
> format (older OpenSSL) — OpenSSL-3 default p12s can fail to import in CI.

The `tauri-mac-sign-notarize` skill automates most of this.

## Cut a release

```bash
# bump versions in lockstep first: package.json, src-tauri/Cargo.toml,
# src-tauri/tauri.conf.json (and CHANGELOG.md)
git tag v1.0.3
git push origin v1.0.3
```

CI does the rest. Verify the published release has both
`Memosa_<version>_aarch64.dmg` and the stable `Memosa-mac-arm64.dmg` alias, then
the website's "Download .dmg" link resolves automatically.
