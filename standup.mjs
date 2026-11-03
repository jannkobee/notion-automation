/**
 * Notion daily stand-up page creation (Node.js 22+; no npm dependencies).
 *
 * Makes only two types of changes:
 *   1. creates missing Month YYYY child pages under an existing root page;
 *   2. creates missing Month D, YYYY pages under that month.
 * Never changes existing page content, tickets, titles, or icons.
 */

const BASE_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2026-03-11';
const TIMEZONE = 'Asia/Manila';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function extractPageId(value) {
  if (!value) throw new Error('Missing NOTION_ROOT_PAGE_ID. Provide a page ID or full Notion page URL.');
  const matches = String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/gi);
  if (!matches?.length) throw new Error('Could not find a 32-hex-character page ID in NOTION_ROOT_PAGE_ID.');
  return matches.at(-1).replace(/-/g, '');
}

export function getLocalDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const val = (name) => parts.find((part) => part.type === name)?.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
}

export function dateDetails(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid date "${isoDate}"; expected YYYY-MM-DD.`);
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid date "${isoDate}".`);
  }
  return {
    year, month, day,
    weekday: WEEKDAYS[date.getUTCDay()],
    isWorkday: date.getUTCDay() >= 1 && date.getUTCDay() <= 5,
    monthTitle: `${MONTHS[month - 1]} ${year}`,
    dayTitle: `${MONTHS[month - 1]} ${day}, ${year}`,
  };
}

function parseArgs(args) {
  let date = getLocalDate();
  let dryRun = false;
  let backfillMonth = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--date') date = args[++i];
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--backfill-month') backfillMonth = true;
    else if (arg === '--help') {
      console.log('Usage: node standup.mjs [--date YYYY-MM-DD] [--dry-run] [--backfill-month]');
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  dateDetails(date);
  return { date, dryRun, backfillMonth };
}

export async function api(token, method, path, body) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (method === 'GET' && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      throw new Error(`${method} ${path} failed: ${error.message}`);
    }
    if (response.ok) return response.json();
    // A 429 response establishes that Notion accepted no write; retrying it is safe.
    if ((method === 'GET' || response.status === 429) && [429, 500, 502, 503, 504, 529].includes(response.status) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const ms = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : 1000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, ms));
      continue;
    }
    const error = await response.text();
    if (response.status === 401) throw new Error('Notion authentication failed. Check NOTION_TOKEN.');
    if ([403, 404].includes(response.status)) {
      throw new Error('Notion access denied or page not found. Check NOTION_ROOT_PAGE_ID and confirm the integration is connected to the root page.');
    }
    throw new Error(`Notion ${method} ${path}: HTTP ${response.status}: ${error.slice(0, 1200)}`);
  }
  throw new Error(`Notion ${method} ${path} failed after retries.`);
}

async function listImmediateChildPages(token, parentId) {
  const children = [];
  let cursor;
  do {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    const page = await api(token, 'GET', `/blocks/${parentId}/children?${params.toString()}`);
    children.push(...page.results.filter(block => block.type === 'child_page' && !block.archived && !block.in_trash));
    cursor = page.has_more ? page.next_cursor : undefined;
    if (page.has_more && !cursor) throw new Error('Pagination stopped without a next cursor.');
  } while (cursor);
  return children;
}

function findUniqueChild(pages, title) {
  const matching = pages.filter(page => page.child_page?.title?.trim() === title);
  if (matching.length > 1) {
    throw new Error(`Found ${matching.length} child pages named "${title}". Resolve duplicates in Notion before continuing.`);
  }
  return matching[0] ?? null;
}

function textBlock(content, bold = false) {
  return {
    object: 'block', type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content }, ...(bold ? { annotations: { bold: true } } : {}) }],
    },
  };
}

function dayTemplate() {
  return [
    textBlock('Investigated:'),
    textBlock('Task:'),
    textBlock('Validated:'),
  ];
}

async function createChildPage(token, parentId, title, iconEmoji, children = []) {
  return api(token, 'POST', '/pages', {
    parent: { type: 'page_id', page_id: parentId },
    icon: { type: 'emoji', emoji: iconEmoji },
    properties: { title: { type: 'title', title: [{ type: 'text', text: { content: title } }] } },
    ...(children.length ? { children } : {}),
  });
}

export function monthWorkdays(year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const result = [];
  for (let day = 1; day <= days; day++) {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (dateDetails(iso).isWorkday) result.push(iso);
  }
  return result;
}

export async function run({ token, rootPageId, date, dryRun = false, backfillMonth = false }) {
  if (!token) throw new Error('Missing NOTION_TOKEN.');
  const rootId = extractPageId(rootPageId);
  const selected = dateDetails(date);

  console.log(`Checking Notion stand-up pages for ${date} (${TIMEZONE})${dryRun ? ' [DRY RUN]' : ''}`);
  await api(token, 'GET', `/pages/${rootId}`);
  const monthPages = await listImmediateChildPages(token, rootId);
  const existingMonth = findUniqueChild(monthPages, selected.monthTitle);
  let monthId = existingMonth?.id;
  if (monthId) {
    console.log(`Month exists: ${selected.monthTitle}`);
  } else {
    console.log(`${dryRun ? 'Would create' : 'Creating'} month: ${selected.monthTitle}`);
    if (!dryRun) {
      const created = await createChildPage(token, rootId, selected.monthTitle, '📅');
      monthId = created.id;
      console.log(`Created month: ${created.url}`);
    }
  }

  const dates = backfillMonth ? monthWorkdays(selected.year, selected.month) : (selected.isWorkday ? [date] : []);
  if (!selected.isWorkday && !backfillMonth) console.log(`${date} is a weekend; no daily page needed.`);
  if (!dates.length) return;

  // Dry runs can list existing days if the month already exists; if not, report the plan.
  const dayPages = monthId ? await listImmediateChildPages(token, monthId) : [];
  for (const day of dates) {
    const title = dateDetails(day).dayTitle;
    const existingDay = findUniqueChild(dayPages, title);
    if (existingDay) {
      console.log(`Daily page exists, left unchanged: ${title}`);
      continue;
    }
    console.log(`${dryRun ? 'Would create' : 'Creating'} daily page: ${title}`);
    if (!dryRun) {
      const created = await createChildPage(token, monthId, title, '📝', dayTemplate());
      dayPages.push({ id: created.id, type: 'child_page', child_page: { title } });
      console.log(`Created daily page: ${created.url}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await run({
    token: process.env.NOTION_TOKEN,
    rootPageId: process.env.NOTION_ROOT_PAGE_ID,
    ...args,
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
