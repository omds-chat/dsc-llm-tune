# dsc-llm-tune

[简体中文](README.md) | [English]

dsc-llm-tune is a dsc plugin that hands the common LLM request parameters straight to you: temperature, top_p, max_tokens and stop sequences. The plugin ships no presets and does not decide what value fits which scenario: whatever value you set goes into the request, and when you set nothing the request is left untouched.

One request should not have its sampling parameters decided by two plugins, so dsc-llm-tune is mutually exclusive with dsc-humanize: both request `chat:request` and both declare `chat:before-request`, so installing them together would let their patches overwrite each other in registration order. Each side declares the conflict in its own manifest, and this repository owns its side.

The plugin is eventually collected by dsc-inner-plugin. This repository is the skeleton plus a working implementation: parameters are set in the host plugin settings page (the master switch defaults to off) with the JSON import kept as the compatibility path; the reasoning is recorded in [docs/design/parameter-tuning.md](docs/design/parameter-tuning.md).

## Positioning

| Item | Description |
|:---:|:---:|
| Audience | People who want precise control over sampling parameters and do not need assistant-shape authoring |
| Scope | `temperature`, `top_p`, `max_tokens`, stop sequences |
| Not provided | Presets, scenario templates, intent-based parameter selection, prompt rewriting |
| vs dsc-humanize | Mutually exclusive: both rewrite the sampling parameters of the same request |
| Distribution | Collected and distributed by dsc-inner-plugin |

## Repository status

- Engineering skeleton carried over from dsc-plugin-template: manifest, activate, deactivate, TypeScript sources and a single-file esbuild bundle
- A local copy of the contract types, so type hints work without the DeepSeek-Chat-Enhanced sources
- A build pipeline: bundle `plugin.js`, generate and self-validate `meta.json` from `package.json`, write the `MUST_PLUSH_WITH_PACKAGE` marker, force LF line endings
- A verifiable spec area: copies of the runtime spec, the development spec and the JSON Schemas, kept for local validation
- A parameter validation layer: ranges, types and stop-sequence rules; any invalid field rejects the whole document
- A plugin storage path: the parameter document lives under `dsc-llm-tune/params/v1` and is loaded on activation
- A request hook: requests `chat:request`, declares `chat:before-request`, and merges the settings-page values with the imported parameters into a host patch; returns `null` when neither source has anything
- A host settings surface registration: requests `settings:locale` and `settings:surface`, declares the parameter fields on activation, and the host renders the form in the plugin details page
- A minimal import entry: `importParameters(jsonText)` and `clearParameters()`, kept as the compatibility path
- A zero-dependency test suite on Node's built-in `node:test`, covering validation, patch mapping, storage loading, import and settings-value merging
- Not implemented yet: document export

## Parameters and the request patch

| Parameter | Document field | Range | Patch field | Notes |
|:---:|:---:|:---:|:---:|:---:|
| temperature | `temperature` | 0 to 2 | `temperature` | Out-of-range values are rejected, never clamped |
| top_p | `topP` | 0 to 1 | `topP` | Out-of-range values are rejected, never clamped |
| max_tokens | `maxTokens` | integer 1 to 4096 | `maxTokens` | Non-integer or out-of-range values are rejected |
| stop | `stop` | up to 4 entries, 32 characters each | `stop` | Kept verbatim, only exact duplicates removed |

- Every field is optional; a missing field stays out of the patch, so the host keeps its own value for that parameter. With no field at all the patch is empty and the handler returns `null`.
- Validation happens at the entries: an invalid import rejects the whole document, and the host validates settings-page values against the declared ranges before persisting them. Nothing is re-validated or clamped before a request.
- `systemPromptAppend` and `systemPromptReplace` are not used: prompts belong to dsc-humanize, this plugin only touches sampling parameters and stop sequences.
- Patch fields, merge order and clamping rules are specified in [specs/plugin-develop-spec.md](specs/plugin-develop-spec.md) section 2.5.

## Setting parameters

Parameters have two entry points: the host settings page (primary) and the JSON import (compatibility path). The priority is decided per field; the full rules live in [docs/design/parameter-tuning.md](docs/design/parameter-tuning.md) section 6.3:

| Priority | Condition | Result |
|:---:|:---:|:---:|
| 1 | The settings-page master switch is on and the field was changed there (effective value differs from the registered default) | The settings page wins |
| 2 | The field has no settings-page override | Fall back to the imported value (the stored parameter document) |
| 3 | Neither source has a value | The field stays out of the patch; with no field at all the request is left unchanged |

### Settings page (primary)

The host provides a plugin settings surface: click a plugin in the installed list to open its details page, where the host renders the form from the field descriptors the plugin registered. This plugin registers five fields:

| Field | Control | Range | Registered default |
|:---:|:---:|:---:|:---:|
| Use settings page values | switch | on / off | off |
| Temperature | number | 0 to 2 | `1` |
| top_p | number | 0 to 1 | `1` |
| Max tokens | number | integer 1 to 4096 | `4096` |
| Stop sequences | text | comma separated, up to 4 entries of 32 characters | empty |

- The registered defaults are not presets: fields you never touched stay out of the patch, and only changed fields follow the settings page. The master switch defaults to off, so import-only usage behaves exactly as before the surface existed.
- The stop-sequence text box splits on commas and trims whitespace around each entry; to keep whitespace inside a stop sequence, use the import entry.
- Field labels render in the host language captured at activation; changing the language afterwards requires reactivating the plugin.

### JSON import (compatibility path)

Parameters are stored as one JSON document under the plugin storage key `dsc-llm-tune/params/v1`:

```json
{
  "paramsVersion": 1,
  "temperature": 0.7,
  "topP": 0.9,
  "maxTokens": 2048,
  "stop": ["\n\nUser:"]
}
```

| Field | Required | Value |
|:---:|:---:|:---:|
| `paramsVersion` | yes | Always `1`; any other value is rejected with `unsupported-version` |
| `temperature` | no | Number from 0 to 2 |
| `topP` | no | Number from 0 to 1 |
| `maxTokens` | no | Integer from 1 to 4096 |
| `stop` | no | Array of strings, at most 4 entries of 32 characters |

The entry points live in [src/index.ts](src/index.ts) and cover setting, reverting and inspecting:

```ts
import { clearParameters, getActiveParameters, importParameters } from 'dsc-llm-tune'

// Import: parse and validate, replace the active parameters only on success;
// when the plugin is active the document is also written back to plugin storage
const result = importParameters(jsonText)
if (!result.ok) {
  // The error carries a code and a field path, for example
  // { code: 'invalid-parameters', message: '...', path: '/temperature' }
  console.log(result.error.code, result.error.path, result.error.message)
}

// Inspect: the active parameters, or null when nothing is set
getActiveParameters()

// Revert: clear the in-memory parameters and drop the stored document
clearParameters()
```

- `importParameters` returns `{ ok: true, params, persisted }` or `{ ok: false, error }`; `persisted: false` means the parameters were only applied in memory, for example when the plugin is inactive or the storage write failed.
- An import while the plugin is inactive only updates memory; the next activation reads plugin storage again.
- Limits of the import path: the entry is a function rather than a UI, suited for bulk pasting, debugging and stop sequences that keep whitespace; fields overridden on the settings page follow the settings page and the imported value does not apply there.
- Revert an import with `clearParameters()`; settings-page values live in the host settings namespace and are not cleared here, reset individual fields to their defaults on the settings page instead.

## Mutual exclusion with dsc-humanize

| Item | Detail |
|:---:|:---:|
| Why | Both rewrite the sampling parameters of the same request; patches are merged in registration order and later scalars win, so the effective value would be unpredictable |
| This side | `conflicts: ['dsc-humanize']` in [src/manifest.ts](src/manifest.ts) |
| Other side | dsc-humanize must declare `dsc-llm-tune` in its own manifest; that repository owns it |
| Host behaviour | Installing both is rejected, judged from the `conflicts` field |
| Scope | Sampling parameters only; prompts stay with dsc-humanize |

Use dsc-humanize when you need assistant shape and prompt authoring, and this plugin when you need precise sampling parameters. Switch between them instead of installing both.

## Specs and schemas

Copies of the plugin runtime spec, the plugin development spec and the JSON Schemas ship with this repository for local validation and pre-release checks. Their source is dsc-plugin-template, and the authoritative implementation remains `dsc-plugin-engine` in DeepSeek-Chat-Enhanced:

| Content | Location |
|:---:|:---:|
| Spec index and known differences | [specs/README.md](specs/README.md) |
| Plugin runtime spec | [specs/plugin-runtime-spec.md](specs/plugin-runtime-spec.md) |
| Plugin development spec | [specs/plugin-develop-spec.md](specs/plugin-develop-spec.md) |
| Spec version and schema paths | [specs/spec-version.json](specs/spec-version.json) |
| Manifest schema | [schemas/manifest/plugin-manifest.schema.json](schemas/manifest/plugin-manifest.schema.json) |
| Runtime meta schema | [schemas/runtime/meta.json](schemas/runtime/meta.json) |

- The implementation in `dsc-plugin-engine` wins over any document; this repository only collects and machine-validates. Differences are recorded under known differences in [specs/README.md](specs/README.md).
- This repository publishes no spec version; other repositories should reference dsc-plugin-template's `specs/spec-version.json` and pin a tag or commit.
- Validation: `node scripts/validate-specs.mjs` (self-check) and `node scripts/validate-specs.mjs <manifest file>` (single manifest). No network, no dependencies.

## Layout

```text
dsc-llm-tune/
├── .env.example              # Local debugging addresses
├── .gitattributes            # LF everywhere
├── .gitignore
├── .npmrc
├── COPYRIGHT
├── LICENSE
├── README.md                 # Chinese main text
├── README.en-US.md           # English translation
├── build.mjs                 # Build entry: bundle and self-validate meta
├── package.json              # Project metadata and source of meta.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml       # pnpm 12 build-script allowlist
├── tsconfig.json
├── docs/
│   ├── README.md             # Documentation index
│   └── design/
│       └── parameter-tuning.md # Design: boundaries, exclusion, gaps, open items
├── schemas/                  # JSON Schemas and fixtures
├── scripts/
│   ├── test/                 # Zero-dependency tests
│   │   ├── ts-hooks.mjs      # Resolver hook so tests load .ts sources
│   │   └── tuning.test.ts    # Validation, patch mapping, storage, import, settings merging
│   └── validate-specs.mjs    # Zero-dependency spec validator
├── specs/                    # Spec copies
└── src/
    ├── index.ts              # Activation, deactivation, settings registration, import and clear
    ├── manifest.ts           # Runtime manifest
    ├── types.ts              # Contract types
    ├── host/
    │   ├── request-patch.ts  # Parameters to request patch
    │   ├── settings.ts       # Settings surface: field descriptors, zh/en labels, value priority
    │   └── store.ts          # Parameter document: key, shape, reading
    └── tuning/
        └── params.ts         # Parameter ranges, validation, in-memory shape
```

## Requirements

| Item | Requirement |
|:---:|:---:|
| Node.js | 18 or newer; tests need 22.18 or newer (built-in type stripping) |
| pnpm | 12 or newer |
| Bundle targets | Chrome 105, Edge 105, Safari 16, Firefox 110 |

pnpm 12 does not run dependency install scripts by default; `pnpm-workspace.yaml` allows the esbuild build script explicitly. Do not remove that file.

## Quick start

```bash
git clone https://github.com/omds-chat/dsc-llm-tune.git
cd dsc-llm-tune
pnpm install
pnpm run type
pnpm run build
pnpm run test
```

| Command | Purpose |
|:---:|:---:|
| `pnpm install` | Install development dependencies |
| `pnpm run type` | Type check with `tsc --noEmit` |
| `pnpm run build` | Build the artifacts into `dist/` |
| `pnpm run build -- --no-minify` | Build without line minification |
| `pnpm run validate:specs` | Validate the schemas, fixtures and this repository's meta |
| `pnpm run test` | Run the zero-dependency tests with `node --test` |

The tests use Node's built-in `node:test`, run offline, and load the TypeScript sources directly. Re-run `pnpm run test` after touching the parameter layer or the wiring.

## Build artifacts

The build clears `dist/` and writes exactly these files:

```text
dist/
├── meta.json                  # Runtime metadata, generated from package.json
├── plugin.js                  # Single-file ESM bundle
└── MUST_PLUSH_WITH_PACKAGE    # Empty marker file
```

| Artifact | Notes |
|:---:|:---:|
| `meta.json` | Self-validated right after generation; the build fails if it is invalid |
| `plugin.js` | Single-file ESM exporting `manifest`, `activate`, `deactivate` and the parameter entry points |
| `MUST_PLUSH_WITH_PACKAGE` | Empty file meaning the directory must ship as a whole |

Keep the file names as they are, including the `MUST_PLUSH_WITH_PACKAGE` spelling. At the end the build prints each artifact size, the minify switch and the total size, and rejects unexpected files in `dist/`. Text artifacts are written as LF; a CR byte fails the build.

## How meta.json is generated

`meta.json` is generated from `package.json` and never edited by hand.

| `meta.json` field | Source | Required |
|:---:|:---:|:---:|
| `name` | `package.json` `name` | yes |
| `version` | `package.json` `version` | yes |
| `license` | `package.json` `license` | yes |
| `author` | `package.json` `author`, as a string | yes |
| `description` | `dsc.description`, an object with at least `zh-CN` or `en-US` | yes |
| `repo_link` | `dsc.repo_link` | yes |
| `dependencies.dsc` | `dsc.engines` | yes |
| `home_page` | `dsc.home_page`, omitted when absent | no |

Renaming the plugin means updating `package.json` `name`: it must match `dsc-xxx` or `@scope/dsc-xxx`, otherwise the `meta.json` validation fails. Version bumps change `version` as a three-part number.

## Changing the manifest

The manifest lives in [src/manifest.ts](src/manifest.ts) and is re-exported by [src/index.ts](src/index.ts); installation uses the bundled `manifest`.

| Field | Required | Notes |
|:---:|:---:|:---:|
| `id` | yes | Must match `^[a-z][a-z0-9-]{2,63}$`; this plugin uses `dsc-llm-tune` |
| `name` | yes | Display name, `LLM Tune` |
| `version` | yes | Three-part plugin version |
| `engines` | no | Compatible dsc-core range, currently `^1.0.0` |
| `dependencies` | no | Plugin dependencies; this plugin has none |
| `conflicts` | no | Conflicting plugin ids, currently `dsc-humanize` |
| `capabilities` | yes | `notify`, `plugins:storage`, `chat:request`, `settings:locale`, `settings:surface` |
| `mounts` | no | `chat:before-request` only |

- `id` is globally unique and defines the storage namespace; changing it means installed instances do not migrate.
- `chat:request` and the `chat:before-request` mount must both be present: registering a handler throws `PluginCapabilityError` when either is missing.
- `conflicts` must match the dsc-humanize manifest; changing one side only removes the exclusion.
- Field rules are specified in [specs/plugin-develop-spec.md](specs/plugin-develop-spec.md); validate a manifest with `node scripts/validate-specs.mjs <manifest file>`.

## Capabilities

| Capability | Context member | Rate limit |
|:---:|:---:|:---:|
| `notify` | `context.ui.notify` | 10 per 10 seconds |
| `plugins:storage` | `context.storage` | 100 per 10 seconds, 64KB per plugin |
| `chat:request` | `context.chat.onBeforeRequest` | 10 per 10 seconds (registration only) |
| `settings:locale` | `context.settings.locale` | 60 per 10 seconds |
| `settings:surface` | `context.settings.register`, `context.settings.values` | 60 per 10 seconds (shared window for registration and reads) |
| `sessions:list`, `sessions:read`, `sessions:rename` | `context.sessions.*` | Not requested |
| `events:session` | `context.events.on` | Not requested |
| `net:fetch` | `context.net.*` | Built-in plugins only; this plugin needs no network |

The plugin requests `notify`, `plugins:storage`, `chat:request`, `settings:locale` and `settings:surface`, and declares only the `chat:before-request` mount: storage persists the parameters, `notify` shows the first-activation notice, `chat:request` delivers the patch, `settings:surface` declares the settings fields and reads their values, and `settings:locale` picks the field labels. Session lists, event subscriptions and networking are unused and therefore not requested.

## Troubleshooting

### The parameters do not take effect

Check in order:

1. Settings page: is the master switch "Use settings page values" on; is the changed value exactly equal to the registered default (equal counts as unchanged and falls back to the import).
2. Import path: whether the import succeeded, whether a later clear or reactivation replaced them, and whether the plugin log shows the parameters being applied or the document missing.
3. Compare against the priority: fields overridden on the settings page follow the settings page, the others follow the import; with neither source the request is left unchanged.
4. Reactivation reads plugin storage again; an import while inactive only updates memory. Settings-page values are read live before each request, so saving is enough and no reactivation is needed.

### A stored value is rejected

Typical causes are `paramsVersion` not equal to `1`, underscore field names such as `top_p` or `max_tokens`, out-of-range numbers, or a `stop` array with more than 4 entries or an entry longer than 32 characters. The log reports the error code and field path; fix the whole document and import it again, since no partial result is kept.

### Installing alongside dsc-humanize is rejected

That is by design: both rewrite the sampling parameters of the same request, so enabling both would let one overwrite the other. Uninstall one before installing the other; use dsc-humanize when you need assistant shape and prompt authoring.

### An unexpected file appears in dist

The build clears `dist/` and validates the artifact list, allowing only `meta.json`, `plugin.js` and `MUST_PLUSH_WITH_PACKAGE`. Anything else means the sources use a dynamic `import()` or pull in an asset that needs its own output.

## Release

- Ship the whole `dist/` directory, not just `plugin.js`: `meta.json` is how the market identifies the plugin and `MUST_PLUSH_WITH_PACKAGE` marks the directory as a unit.
- Keep the directory layout and the `meta.json` field names; the market and the collection parse them by convention.
- Host the artifacts on an HTTPS static site or CDN with a stable URL. The host fetches the bytes, so the host must send `Access-Control-Allow-Origin`.
- Before releasing, run `import('https://your-host/plugin.js')` in a browser console to confirm there are no syntax errors or missing dependencies.
- `dist/` is ignored by git; attach the artifacts to a release when you need to ship them.
- The plugin runs in the user's browser and can read the visible fields of the current session; tell users to install only trusted sources.
- State in the release or user notes that the parameters are set in the host plugin details page (the master switch defaults to off), that the JSON import stays as the compatibility path, and that on hosts older than the settings surface only the import path exists.
