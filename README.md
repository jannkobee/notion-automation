# Notion Daily Stand-up Page Automation

Creates and maintains this exact page hierarchy, using **ordinary Notion nested pages**:

```
Daily Stand Up Meeting Notes (your existing page; never modified)
└── November 2026                    (created if missing)
    ├── November 2, 2026             (created if missing)
    ├── November 3, 2026             (created if missing)
    │   ├── Investigated:            (blank area for manual ticket links)
    │   ├── Task:
    │   └── Validated:
    └── November 4, 2026
```

You continue adding ticket links manually. **The script only adds missing pages.** It never edits, archives, sorts, deletes, or replaces existing page content.

## 1. Get a Notion API token

For a personal automation, Notion's [personal access token](https://www.notion.so/profile/integrations) is convenient. In the [Notion developer portal](https://developers.notion.com/guides/notion-api/quick-start), create a personal access token with Notion API access. The token uses your user permissions.

Alternatively, create a Notion **internal connection** with *read content* and *insert content* capabilities, and **open the existing "Daily Stand Up Meeting Notes" page → `•••` → `Add connections` → select your connection**. This is necessary for internal connections. The root page must be a regular Notion page with nested child pages, not merely links to pages elsewhere.

**Never paste the token into chat or commit it to a repository.**

## 2. Find your root page ID

Open the **Daily Stand Up Meeting Notes** page in Notion, then select **Copy link**. The 32-hex-character identifier at the end of the page URL is the page ID. The script accepts either the complete URL or the ID.

## 3. Test locally

Requires **Node.js 22 or newer**. No `npm install` is needed.

From this folder, set environment variables in your terminal:

**PowerShell:**

```powershell
$env:NOTION_TOKEN = "ntn_your_token_here"
$env:NOTION_ROOT_PAGE_ID = "https://www.notion.so/your-page-name-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
node standup.mjs --date 2026-11-03 --dry-run
node standup.mjs --date 2026-11-03
```

**Linux/macOS:**

```bash
export NOTION_TOKEN='ntn_your_token_here'
export NOTION_ROOT_PAGE_ID='https://www.notion.so/your-page-name-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
node standup.mjs --date 2026-11-03 --dry-run
node standup.mjs --date 2026-11-03
```

The **dry-run checks existing pages but creates nothing**. Run the second command only after verifying the plan.

## 4. Make it automatic with GitHub Actions

1. Create a **private** GitHub repository and push the files from this folder, including `.github/workflows/notion-standup.yml`, to the repository's **default branch**.
2. Go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Add `NOTION_TOKEN` with your actual Notion API token.
4. Add `NOTION_ROOT_PAGE_ID` with your root page's ID or complete URL.
5. Go to **Actions → Create Notion daily stand-up pages → Run workflow** to test it.
6. Leave the workflow enabled. It runs **every day at 08:10 Asia/Manila**. It creates a month page if missing, then creates **today's page only on Monday through Friday**.

GitHub scheduled workflows can be delayed or occasionally dropped. If a daily run is missed, trigger it manually with `--date` locally or use the optional backfill command. The script is idempotent for ordinary sequential runs.

## Optional: Create all weekdays in a month in advance

```bash
node standup.mjs --date 2026-11-03 --backfill-month --dry-run
node standup.mjs --date 2026-11-03 --backfill-month
```

This creates **all Monday–Friday pages** in that month, including future weekdays; it does **not** know Philippine public holidays, approved leave days, or other personal days off. Existing dated pages remain untouched.

## Behavior and safety

- Uses timezone **Asia/Manila** for date calculation.
- Names are exact: `November 2026` → `November 3, 2026`.
- Existing child pages are detected by exact title and parent, with paginated Notion API lookups.
- Duplicated matching titles generate an error rather than choosing arbitrarily.
- `Investigated:`, `Task:`, and `Validated:` are added to **new daily pages only**.
- Pre-existing ticket links and formatted blocks are never rewritten.
- Every new month gets 📅 and every new day gets 📝; existing icons remain unchanged.
- New pages are appended by Notion; the script does not reorder existing child pages.
- The job cannot create pages if Notion permissions do not allow it.
- If a network failure happens after a write is accepted but before the response arrives, the next run rechecks for the page before attempting creation again. Extremely rare concurrent external writes may still create duplicate pages, because Notion does not offer an atomic create-if-not-exists operation on nested page titles.
- `--backfill-month` is optional. No holiday detection or ticket synchronization occurs.

## Troubleshooting

- **401:** Token is invalid. Check `NOTION_TOKEN`.
- **403/404:** Integration is not connected to the root Notion page, page ID is wrong, or access rights are insufficient. For a PAT, check your user access and selected workspace.
- **Validation error:** Verify the root is a real page and the new page can be created underneath it.
- **Existing month not detected:** Check that the month pages are actual nested subpages, not hyperlink blocks or links to pages in another location.
- **GitHub schedule didn't run:** Check Actions is enabled and workflow is in the default branch. Scheduled execution is best effort, not a hard real-time guarantee.

Documentation: [Notion API quickstart](https://developers.notion.com/guides/notion-api/quick-start), [Notion block children](https://developers.notion.com/reference/get-block-children), [GitHub Actions schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
