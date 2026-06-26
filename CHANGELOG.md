# [1.8.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.7.0...v1.8.0) (2026-06-26)


### Features

* **join:** add copy-paste server join tokens ([5ab64e6](https://github.com/AlexanderSlaa/wgctl/commit/5ab64e6bf78ce8e162b68445cbedc09f1bddb906))

# [1.7.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.6.1...v1.7.0) (2026-06-26)


### Features

* **install:** add hosted Debian installer ([5444b00](https://github.com/AlexanderSlaa/wgctl/commit/5444b003a22ac12cc1eedde5945fec550071048c))

## [1.6.1](https://github.com/AlexanderSlaa/wgctl/compare/v1.6.0...v1.6.1) (2026-06-26)


### Bug Fixes

* **cli:** report missing runtime dependencies clearly ([a76cf64](https://github.com/AlexanderSlaa/wgctl/commit/a76cf64a0311a0fba9c00b794163323432d701b9))

# [1.6.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.5.0...v1.6.0) (2026-06-26)


### Bug Fixes

* **security:** address all five findings from security audit ([428cf73](https://github.com/AlexanderSlaa/wgctl/commit/428cf73404e23fcb18c3be54df654107d790403a))


### Features

* **cli:** add uninstall and manual peer configs ([36a46cb](https://github.com/AlexanderSlaa/wgctl/commit/36a46cb70528fdaab6ee6251263bd63f398368d6))

# [1.5.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.4.0...v1.5.0) (2026-06-26)


### Features

* validate and build native addon at runtime instead of install time ([30e9f8a](https://github.com/AlexanderSlaa/wgctl/commit/30e9f8a89cadeb558ec2550bed0e5b041981bfb9))

# [1.4.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.3.0...v1.4.0) (2026-06-25)


### Features

* **cli:** add wgctl setup first-run wizard ([eac8e2a](https://github.com/AlexanderSlaa/wgctl/commit/eac8e2a198817468cdf606a979fc7ce0f8184500))

# [1.3.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.2.0...v1.3.0) (2026-06-24)


### Features

* **cli:** auto-elevate with sudo instead of just erroring ([0cf932f](https://github.com/AlexanderSlaa/wgctl/commit/0cf932f1a1ff978fe77c2690bdc89679a79c41e1))

# [1.2.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.1.0...v1.2.0) (2026-06-24)


### Features

* **server:** support --host/--port flags on wgctl serve ([01eec55](https://github.com/AlexanderSlaa/wgctl/commit/01eec55a9524b1a0c48bfe277e4a01f3b0e8df08))

# [1.1.0](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.5...v1.1.0) (2026-06-24)


### Features

* **cli:** add wgctl up to re-bring the tunnel up without re-prompting ([b111170](https://github.com/AlexanderSlaa/wgctl/commit/b111170677516f9ef1d305c55c7056d9adb2a174))

## [1.0.5](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.4...v1.0.5) (2026-06-24)


### Bug Fixes

* **client:** force a fresh TLS handshake per request for fingerprint pinning ([1a1e726](https://github.com/AlexanderSlaa/wgctl/commit/1a1e72639c4579d93789f1a1f96ecd0b3d9d81d9))

## [1.0.4](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.3...v1.0.4) (2026-06-24)


### Bug Fixes

* **cli:** show actionable error for missing native libs, lazy-load commands ([5df40ad](https://github.com/AlexanderSlaa/wgctl/commit/5df40adfa415cd8ca0395ca48a5f96e5529706bd))

## [1.0.3](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.2...v1.0.3) (2026-06-24)


### Bug Fixes

* **deps:** bump node-wireguard to 1.0.2 ([7b87745](https://github.com/AlexanderSlaa/wgctl/commit/7b8774506d738e04b8470c98ffde7d749e5ea174))

## [1.0.2](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.1...v1.0.2) (2026-06-24)


### Bug Fixes

* **ci:** allow manual release runs via workflow_dispatch ([d948750](https://github.com/AlexanderSlaa/wgctl/commit/d9487508344cc5a200723b6d79e02b8bd0d17e94))

## [1.0.1](https://github.com/AlexanderSlaa/wgctl/compare/v1.0.0...v1.0.1) (2026-06-24)


### Bug Fixes

* **packaging:** use relative bin path without leading ./ to avoid npm normalization warning ([3655d53](https://github.com/AlexanderSlaa/wgctl/commit/3655d53b5b49d89a2328546802dd7a8193aa28af))

# 1.0.0 (2026-06-24)


### Features

* **cli:** confirm before wgctl update, clarify tunnel impact ([7daf7e8](https://github.com/AlexanderSlaa/wgctl/commit/7daf7e8e2b746e64dc563729082b2923598d2511))
* **cli:** notify of npm updates and add `wgctl update` ([40a320d](https://github.com/AlexanderSlaa/wgctl/commit/40a320d57c76d2a651d03a212251511fcb303f0e))
* **cli:** support --server on networks/connect/down for multi-server logins ([4ab1891](https://github.com/AlexanderSlaa/wgctl/commit/4ab1891408d473a75a813da289d4f2c81796e151))
