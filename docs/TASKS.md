# Memosa — Tasks

Crash-safe task list. Current focus: **open-sourcing Memosa** (mirroring Prevail's setup).

## Open-source launch

- [x] Decide license / repo / signing / site-CTA (GPL-3.0 · frulouis/memosa · sign+notarize · App Store primary + DMG secondary)
- [x] Verify no secrets in working tree or git history
- [x] Add `LICENSE` (GPL-3.0)
- [x] Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- [x] Add `CHANGELOG.md`
- [x] Add `.github/` issue + PR templates
- [x] Add `.github/workflows/test.yml` (typecheck + cargo test/clippy)
- [x] Add `.github/workflows/release.yml` (build + sign + notarize DMG on `v*` tag)
- [x] Add Developer ID entitlements + config overlay (`entitlements-devid.plist`, `tauri.conf.devid.json`)
- [x] README: open-source framing + download badges
- [x] memosa-site: add direct `.dmg` download link (App Store stays primary)
- [x] Flip repo public + push (fru-dev3/memosa, GPL-3.0; old history preserved at branch `legacy/pre-oss-main`)
- [x] Push website direct-`.dmg` link (fru-dev3/memosa-site; Netlify auto-deploys; verified live on memosa.dev)
- [x] Build + sign DMG locally (Developer ID cert in keychain: "Developer ID Application: Fru Nde (TXN399AHT5)", hardened runtime)
- [x] Publish DMG to GitHub Release `1.0.2` (non-`v` tag so the CI release workflow doesn't overwrite it with an unsigned build); stable alias `Memosa-mac-arm64.dmg`. Download link verified HTTP 200.
- [ ] **USER (notarization):** create an app-specific password at appleid.apple.com, then run:
      `xcrun notarytool store-credentials memosa-notary --apple-id fru.dev3@gmail.com --team-id TXN399AHT5 --password <app-pw>`
      Then I run: `notarytool submit Memosa-mac-arm64.dmg --keychain-profile memosa-notary --wait` → `stapler staple` → re-upload (clobber). Until then the DMG is signed-not-notarized (spctl: "Unnotarized Developer ID"; users right-click→Open).
- [ ] **USER (CI, optional):** add Apple signing secrets so future `v*` tags auto-sign+notarize (see `docs/RELEASING.md`).

## Next (after open-source)

- [ ] New features (TBD by founder)
