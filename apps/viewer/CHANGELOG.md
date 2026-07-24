# Changelog

## [1.0.0](https://github.com/say8425/diffdeck/compare/diffdeck-v0.3.0...diffdeck-v1.0.0) (2026-07-24)


### Features

* **viewer:** add draggable sidebar resize ([#13](https://github.com/say8425/diffdeck/issues/13)) ([f5879d7](https://github.com/say8425/diffdeck/commit/f5879d7da63bcdd9349e733c23f856790f7b0bf0))
* **viewer:** sync sidebar directory collapse to diff fold state ([#14](https://github.com/say8425/diffdeck/issues/14)) ([5a0bf71](https://github.com/say8425/diffdeck/commit/5a0bf71db7e0bba3d1302e599717c705c8420e9c))


### Bug Fixes

* **viewer:** plug findBar listener leak, fix un-awaited rejection assertions, harden test isolation ([#20](https://github.com/say8425/diffdeck/issues/20)) ([2101323](https://github.com/say8425/diffdeck/commit/2101323beee7fb705617bf19cf5392475c5a0dd3))
* **viewer:** stop diff content going empty/garbled for non-ASCII filenames ([#17](https://github.com/say8425/diffdeck/issues/17)) ([7ce05be](https://github.com/say8425/diffdeck/commit/7ce05beec5f4d83bfa547c2a001dfe95e8a56355))
* **viewer:** tooltip for truncated diff header filenames ([#23](https://github.com/say8425/diffdeck/issues/23)) ([afc35e3](https://github.com/say8425/diffdeck/commit/afc35e39b7a896c1386429dec4a76229d7a800ab))

## [0.3.0](https://github.com/say8425/diffdeck/compare/diffdeck-v0.2.2...diffdeck-v0.3.0) (2026-07-22)


### Features

* **viewer:** add hide-sidebar toggle ([#10](https://github.com/say8425/diffdeck/issues/10)) ([daf9213](https://github.com/say8425/diffdeck/commit/daf92135d5bb12fe2302254dbad6702413453fdc))


### Bug Fixes

* **viewer:** scale to very large change sets with change-proportional updates ([#12](https://github.com/say8425/diffdeck/issues/12)) ([dfe70ff](https://github.com/say8425/diffdeck/commit/dfe70ff1630cea34ac5fe8930be35614e3bd082f))

## [0.2.2](https://github.com/say8425/diffdeck/compare/diffdeck-v0.2.1...diffdeck-v0.2.2) (2026-07-19)


### Bug Fixes

* make a published diffdeck actually reach users with a warm daemon ([#8](https://github.com/say8425/diffdeck/issues/8)) ([a76e105](https://github.com/say8425/diffdeck/commit/a76e105e23a2467f9c69e1d0b81bdc1b0fe0e733))

## [0.2.1](https://github.com/say8425/diffdeck/compare/diffdeck-v0.2.0...diffdeck-v0.2.1) (2026-07-17)


### Bug Fixes

* **viewer:** stop the sticky file header going transparent and blinking ([#6](https://github.com/say8425/diffdeck/issues/6)) ([baa4429](https://github.com/say8425/diffdeck/commit/baa4429961b1fae0dbb5ae8010427241c9ab0757))

## [0.2.0](https://github.com/say8425/diffdeck/compare/diffdeck-v0.1.0...diffdeck-v0.2.0) (2026-07-16)


### Features

* add diffdeck agent skill (single source) + bundle into dist ([a5fd38d](https://github.com/say8425/diffdeck/commit/a5fd38d2387a08a7ecfef79698d5b1fd5808c13a))
* Claude Code + Codex plugin manifests (repo as single-plugin marketplace) ([30bfb6a](https://github.com/say8425/diffdeck/commit/30bfb6a0eaa5f25761d39b73f64fac2a354895c2))
* **cli:** diffdeck install-skill subcommand (Claude Code + Codex, user/project) ([1ba9fd1](https://github.com/say8425/diffdeck/commit/1ba9fd1076181a398619a12172053c99710a9808))
* **cli:** parse launch view flags + pure toggle-state resolvers ([47b9e1a](https://github.com/say8425/diffdeck/commit/47b9e1a1660de04241dcf14ec648dc3346241b9c))
* **cli:** pass launch view flags into the viewer URL ([7114b67](https://github.com/say8425/diffdeck/commit/7114b679fb3fbf2aaeaf1803403e936797601e88))
* **viewer:** add CLI arg + opener pure helpers ([382abf8](https://github.com/say8425/diffdeck/commit/382abf8eafc174c7ca58d8981ec3eb84681ea0fd))
* **viewer:** add diffdeck CLI entry + dist/cli.js bundle ([f09291d](https://github.com/say8425/diffdeck/commit/f09291d8b291a2819f2c6d3dfa7f160cafc5e846))
* **viewer:** build + serve entry + built-bundle serving test ([e868629](https://github.com/say8425/diffdeck/commit/e86862950f97c61e44344ca4cf860157403cd9bd))
* **viewer:** init toggles from launch flags, synced UI, session-only ([d2129f7](https://github.com/say8425/diffdeck/commit/d2129f7a29592791475ce2d9f18fcd0cfa36127b))
* **viewer:** migrate browser frontend + viewer tests ([538936b](https://github.com/say8425/diffdeck/commit/538936bb716dd6e282be35202351153cea7ab546))
* **viewer:** package apps/viewer as publishable @say8425/diffdeck ([226040c](https://github.com/say8425/diffdeck/commit/226040c855b8592d776458d07a953defeee58dc2))
* **viewer:** scaffold app + migrate diff-server + server tests ([2e7b7d8](https://github.com/say8425/diffdeck/commit/2e7b7d8f5b4511be107687111de5221ca25bd48d))
