# Findings: auto_approve + Dashboard UX

## Requirements
- auto_approve boolean config: ~/.hive-exp/config.json + HIVE_EXP_AUTO_APPROVE env override, default true
- MCP record: auto_approve=true → write to promoted/, emit experience.created + experience.promoted (auto_approved:true)
- Dashboard: new Settings tab with auto_approve toggle + risk description text
- Dashboard: strategy name search on Experiences tab
- Dashboard: "View" detail button per experience row → detail panel/modal
- Dashboard: i18n fix — provisional="待审核", promoted="已通过", remove "待审阅" card, promote button="通过"
- CLI: `hive-exp config get/set` command
- All three contexts add autoApprove field

## Key Code Locations

### Config (TO CREATE)
- packages/core/src/config.ts — resolveConfig(dataDir) → { autoApprove: boolean }

### MCP Record (MODIFY)
- packages/mcp/src/tools/record.ts:120 — currently always writes to provisionalDir
- Branch: if autoApprove → promotedDir, set provisional=false/promoted=true, emit 2 events

### Contexts (MODIFY — add autoApprove)
- packages/mcp/src/context.ts
- apps/cli/src/context.ts
- apps/dashboard/src/context.ts

### Dashboard Backend (CREATE + MODIFY)
- apps/dashboard/src/api/config.ts (NEW) — GET/PUT /api/config
- apps/dashboard/src/api/index.ts — register config routes
- apps/dashboard/src/api/experiences.ts:111-143 — promote endpoint does real move (not just pending_promotion)

### Dashboard Frontend (MODIFY)
- apps/dashboard/public/main.js — Settings tab, search input, detail panel, i18n strings
- apps/dashboard/public/index.html — Settings tab HTML, search input element
- apps/dashboard/public/styles.css — Settings tab styles, detail modal styles

### CLI (CREATE + MODIFY)
- apps/cli/src/commands/config.ts (NEW) — config get/set
- apps/cli/src/index.ts — register config command
