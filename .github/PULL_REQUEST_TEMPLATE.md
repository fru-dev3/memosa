<!-- Conventional-commit title, e.g. feat(audio): … / fix(transcription): … -->

## What & why


## Checklist
- [ ] `npx tsc --noEmit` and `npm run build` pass
- [ ] `cargo test` and `cargo clippy` pass (in `src-tauri/`)
- [ ] New on-disk format? Added a Rust round-trip test
- [ ] No secrets committed; new off-device data paths are opt-in and labelled
- [ ] UI uses geometric marks, not emojis
