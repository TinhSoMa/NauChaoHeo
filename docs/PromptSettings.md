# PromptSettings — UI & Architecture

## Component
`src/renderer/src/components/settings/PromptSettings.tsx` — React 19, CSS Modules.

Layout (no header, 2 columns):
```
container (flex column)
  content + mainLayout (flex row, flex:1)
    leftPane  (280px) — prompt family list
    rightPane (flex:1) — editor
  assignmentBar (bottom strip)
```

## State (Zustand-less, local useState)
| State | Type | Purpose |
|---|---|---|
| `families` | `PromptFamilyRecord[]` | All families (latest version per family) |
| `groups` | `PromptGroupRecord[]` | All groups |
| `selectedGroupFilter` | `'__all__' \| '__ungrouped__' \| string` | Left pane filter |
| `selectedFamilyId` | `string` | Currently selected family |
| `versions` | `PromptRecord[]` | All versions of selected family |
| `selectedVersionId` | `string` | Currently viewed version |
| `editor` | `EditorForm` | Form fields (name, type, lang, content, groupId) |
| `editorMode` | `'new-version' \| 'new-family'` | Controls save button behavior |
| `systemPrompt` | `string` | DeepSeek system prompt (DB-backed) |
| `translationFamilyId` / `summaryFamilyId` / `captionFamilyId` | `string` | Pipeline assignment |
| `showGroupModal` | `boolean` | Group creation dialog |
| `toast` | `{message, type} \| null` | Notification |

## Key Behaviors
- **Family list scoped by language bucket**: `familyList` only shows families matching `selectedFamily.languageBucket` (filter in `useMemo`)
- **System prompt** saved separately via `deepseekService` (DB column `deepseek_config.system_prompt`), has reset-to-default button
- **Assignment bar**: maps `captionFamilyId`/`translationFamilyId`/`summaryFamilyId` to `app_settings` table; caption falls back to all families if none of type `caption` exist
- **Version selector** inside User Prompt sectionCard, between header and description input
- **Loading state**: spinner centered, `min-height: 280px`
- **Character count** shown below user prompt textarea

## CSS (`PromptSettings.module.css`)
- All styles self-contained (no dependency on `Settings.module.css`)
- Padding aggressively minimized: content `6px 10px`, assignment bar `4px 10px`
- `.leftPane` has NO `overflow` (removed to fix list clipping); `.promptList` has `overflow-y: auto; flex: 1; min-height: 0`
- `.rightPane` has `overflow-y: auto; flex: 1`
- `.mainLayout` explicitly `flex-direction: row` (overrides `.content`'s `column`)
- `.textareaUser` `max-height: 320px` to prevent infinite growth
- `.textareaSystem` `max-height: 200px`

## IPC Dependencies
### `window.electronAPI.prompt.*` (from `src/preload/promptApi.ts`)
| Method | Channel |
|---|---|
| `.getHierarchy()` | `prompt:getHierarchy` |
| `.getVersions(familyId)` | `prompt:getVersions` |
| `.create(data)` | `prompt:create` |
| `.update(id, data)` | `prompt:update` |
| `.delete(id)` | `prompt:delete` |
| `.createGroup(payload)` | `prompt:createGroup` |

### `window.electronAPI.deepSeek.*` (from `src/preload/deepseekApi.ts`)
| Method | Channel |
|---|---|
| `.getSystemPrompt()` | `deepseek:getSystemPrompt` |
| `.setSystemPrompt(value)` | `deepseek:setSystemPrompt` |
| `.resetSystemPrompt()` | `deepseek:resetSystemPrompt` |

### `window.electronAPI.appSettings.*`
| Method | Channel |
|---|---|
| `.getAll()` | `appSettings:getAll` |
| `.update(data)` | `appSettings:update` |

## DB Tables
- **`prompts`**: columns `id, name, description, source_lang, target_lang, content, prompt_type, language_bucket, group_id, family_id, version_no, is_latest, archived, created_at, updated_at`; indexes on `language_bucket`, `family_id`, `group_id`
- **`prompt_groups`**: columns `id, language_bucket, name, normalized_name, created_at, updated_at`; unique constraint `(language_bucket, normalized_name)`
- **`deepseek_config`**: single-row table with `system_prompt` column
- **`app_settings`**: stores `translationPromptFamilyId`, `summaryPromptFamilyId`, `captionPromptFamilyId`, `translationPromptId`, `summaryPromptId`, `captionPromptId`

## Backend
- `src/main/services/promptService.ts` — all prompt CRUD + hierarchy logic; `create()` generates UUID+family+version in a transaction; `update()` creates a new version; `delete()` promotes next-oldest to `is_latest`
- `src/main/ipc/promptHandlers.ts` — registers 15 IPC handlers delegating to PromptService
- `src/main/services/promptService.ts` — `resolveLatestByFamily(familyId)` for finding current version
- `src/main/database/deepseekDatabase.ts` — `DEFAULT_SYSTEM_PROMPT` fallback constant

## Type Constraints (two tsconfigs)
- Main/preload: `"module": "Node16"`, imports need `.js` extension, checked via `tsconfig.main.json`
- Renderer: `"moduleResolution": "bundler"`, no `.js` extension, checked via root `tsconfig.json`
- Both must pass: `npx tsc -p tsconfig.main.json --noEmit && npx tsc --noEmit`
