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
- [ ] **USER:** create "Developer ID Application" cert + add GitHub secrets (see `docs/RELEASING.md`)
- [ ] **USER:** push first `v*` tag to produce the signed DMG release
- [ ] Flip repo public + push

## Next (after open-source)

- [ ] New features (TBD by founder)
