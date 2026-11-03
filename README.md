# Notion Daily Stand-up Automation

This service creates weekday pages under an existing `Daily Stand Up Meeting Notes` root page:

```text
Daily Stand Up Meeting Notes
└── November 2026
    └── November 3, 2026
        ├── Investigated:
        ├── Task:
        └── Validated:
```

It only creates missing pages. It never edits existing pages, blocks, icons, covers, or ticket content. New pages receive a random emoji icon and cover image. GitHub Actions is not required.

## 1. Create and share a Notion integration

1. Open <https://www.notion.so/profile/integrations> and create an internal integration.
2. Grant it `Read content`, `Update content`, and `Insert content`.
3. Open the existing `Daily Stand Up Meeting Notes` page in Notion.
4. Choose `•••` → `Connections` → add the integration.
5. Copy the integration token.

All pages below the root should also remain accessible to that integration through the connected root page.

## 2. Find the root page ID

Open the root page and use `Copy link`. The page ID is the final 32 hexadecimal characters in the URL. Both an ID and a full Notion URL are accepted. For example:

```text
https://www.notion.so/Daily-Stand-Up-Meeting-Notes-0123456789abcdef0123456789abcdef
```

Use `0123456789abcdef0123456789abcdef`.

## 3. Configure Docker

Copy the environment template:

```bash
cp .env.example .env
```

Set the real values in `.env`:

```dotenv
NOTION_TOKEN=your_notion_integration_token
NOTION_ROOT_PAGE_ID=0123456789abcdef0123456789abcdef
TZ=Asia/Manila
SCHEDULE_CRON=0 8 * * 1-5
```

The default cron runs at 08:00 Monday–Friday in `Asia/Manila`. The container checks immediately on startup, then runs on the cron schedule. Cron syntax is configured as `<minute> <hour> <day-of-month> <month> <day-of-week>`.

## 4. Build and start

```bash
docker compose build
docker compose up -d
docker compose ps
```

The service restarts automatically unless it is explicitly stopped:

```bash
docker compose stop
docker compose start
```

## 5. Manual commands

Run commands inside the service container:

```bash
# Check today's pages.
docker compose run --rm notion-standup node standup.mjs

# Dry run today's page creation.
docker compose run --rm notion-standup node standup.mjs --dry-run

# Create or check a specific date.
docker compose run --rm notion-standup node standup.mjs --date 2026-11-03

# Preview all weekday pages in the selected month.
docker compose run --rm notion-standup node standup.mjs --date 2026-11-03 --backfill-month --dry-run

# Create all missing weekday pages in the selected month.
docker compose run --rm notion-standup node standup.mjs --date 2026-11-03 --backfill-month

# Preview adding icons/covers to existing month and daily pages that lack either.
docker compose run --rm notion-standup node standup.mjs --backfill-appearance --dry-run

# Add only missing icons/covers to existing month and daily pages.
docker compose run --rm notion-standup node standup.mjs --backfill-appearance
```

These commands reuse the same creation and duplicate checks as the scheduler.

## 6. Logs

```bash
docker compose logs -f notion-standup
docker compose logs --tail=100 notion-standup
```

## 7. Local tests

No Notion writes are made by the tests.

```bash
npm ci
npm test
```

Docker validation:

```bash
docker compose config
docker compose build
```

## Troubleshooting

- `401` or authentication failed: verify `NOTION_TOKEN` and copy the token from the integration settings.
- `403` or `404`: verify `NOTION_ROOT_PAGE_ID`, then add the integration to the root page under `•••` → `Connections`.
- Validation errors: confirm the root is a real Notion page and its integration access is enabled.
- Existing month is not found: it must be an actual child page beneath the root page, not a link block.
- Missing scheduled execution: inspect logs and verify the cron expression and container status.
- Duplicate risk: lookups are exact and sequential runs are idempotent, but Notion has no atomic create-if-not-exists operation. A duplicate title may occur only with simultaneous external or multi-container writes. Run one container for this automation. If scaled, coordinate instances externally; this application does not silently modify either copy.

## Safety

The automation checks direct child pages with pagination, creates the month page if needed, and only creates a missing weekday under that month. Existing matching pages are preserved. Monthly and daily duplicate titles are reported so conflicts can be resolved manually in Notion.
Newly created month and daily pages receive randomly selected emoji icons and external Unsplash cover images; existing icons and covers are never changed.
