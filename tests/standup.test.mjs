import test from 'node:test';
import assert from 'node:assert/strict';
import { api, dateDetails, getLocalDate, monthWorkdays, extractPageId, randomPageAppearance, backfillPageAppearances, run } from '../standup.mjs';

const ROOT = '11111111111111111111111111111111';
const MONTH = '22222222222222222222222222222222';
const DAY = '33333333333333333333333333333333';

function mockNotion({ startWithMonth = false, startWithDay = false } = {}) {
  const children = new Map([[ROOT, []], [MONTH, []], [DAY, []]]);
  if (startWithMonth) children.get(ROOT).push({id:MONTH,type:'child_page',child_page:{title:'November 2026'}});
  if (startWithDay) children.get(MONTH).push({id:DAY,type:'child_page',child_page:{title:'November 3, 2026'}});
  const writes = [];
  globalThis.fetch = async (rawUrl, opts) => {
    const url = new URL(rawUrl);
    if (opts.method === 'GET') {
      const pageMatch = url.pathname.match(/^\/v1\/pages\/(\w+)$/);
      if (pageMatch) {
        assert.equal(pageMatch[1], ROOT);
        return Response.json({id: ROOT, object: 'page'});
      }
      const match = url.pathname.match(/^\/v1\/blocks\/(\w+)\/children$/);
      if (!match) return new Response('missing endpoint', {status:404});
      return Response.json({results: children.get(match[1]) ?? [], has_more:false, next_cursor:null});
    }
    if (opts.method === 'POST') {
      assert.equal(url.pathname, '/v1/pages');
      const body = JSON.parse(opts.body);
      writes.push(body);
      const id = body.parent.page_id === ROOT ? MONTH : DAY;
      const title = body.properties.title.title[0].text.content;
      children.get(body.parent.page_id).push({id,type:'child_page',child_page:{title}});
      return Response.json({id,url:`https://notion.so/${id}`});
    }
    return new Response('unsupported', {status:500});
  };
  return { children, writes };
}

test('Asia/Manila date, titles, leap year validation, and weekends', () => {
  assert.equal(getLocalDate(new Date('2026-11-02T16:05:00.000Z')), '2026-11-03');
  assert.equal(dateDetails('2026-11-03').dayTitle, 'November 3, 2026');
  assert.equal(dateDetails('2026-11-01').isWorkday, false);
  assert.equal(monthWorkdays(2026, 11).length, 21);
  assert.throws(()=>dateDetails('2026-02-30'));
  assert.equal(extractPageId(`https://www.notion.so/Daily-Stand-Up-${ROOT}?pvs=4`), ROOT);
});

test('creates missing month and daily template, and leaves them untouched on second run', async () => {
  const original = globalThis.fetch;
  try {
    const {writes} = mockNotion();
    const args = {token:'fake', rootPageId:ROOT, date:'2026-11-03'};
    await run(args);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].properties.title.title[0].text.content, 'November 2026');
    assert.equal(writes[1].properties.title.title[0].text.content, 'November 3, 2026');
    assert.deepEqual(writes[1].children.filter(b => b.paragraph.rich_text.length).map(b => b.paragraph.rich_text[0].text.content), ['Investigated:', 'Task:', 'Validated:']);
    await run(args);
    assert.equal(writes.length, 2);
  } finally {globalThis.fetch=original;}
});

test('does not write when matching daily page already exists', async () => {
  const original = globalThis.fetch;
  try {
    const {writes}=mockNotion({startWithMonth:true,startWithDay:true});
    await run({token:'fake',rootPageId:ROOT,date:'2026-11-03'});
    assert.equal(writes.length,0);
  } finally {globalThis.fetch=original;}
});

test('creates month but not daily page on weekend', async () => {
  const original=globalThis.fetch;
  try {
    const {writes}=mockNotion();
    await run({token:'fake',rootPageId:ROOT,date:'2026-11-01'});
    assert.equal(writes.length,1);
  } finally {globalThis.fetch=original;}
});

test('dry run never writes and supports backfill preview', async () => {
  const original=globalThis.fetch;
  try {
    const {writes}=mockNotion();
    await run({token:'fake',rootPageId:ROOT,date:'2026-11-03',dryRun:true,backfillMonth:true});
    assert.equal(writes.length,0);
  } finally {globalThis.fetch=original;}
});

test('retries transient Notion failures', async () => {
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 503 });
      return Response.json({ ok: true });
    };
    assert.deepEqual(await api('fake', 'GET', '/test'), {ok: true});
    assert.equal(calls, 2);
  } finally {globalThis.fetch=original;}
});

test('reports Notion authentication and permission errors clearly', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', {status: 401});
    await assert.rejects(api('fake', 'GET', '/pages/123'), /authentication failed/i);
    globalThis.fetch = async () => new Response('', {status: 403});
    await assert.rejects(api('fake', 'GET', '/pages/123'), /access denied/i);
  } finally {globalThis.fetch=original;}
});

test('uses random icon and cover values for newly created pages', async () => {
  const original = globalThis.fetch;
  try {
    const {writes} = mockNotion();
    await run({token:'fake', rootPageId:ROOT, date:'2026-11-03'});
    assert.equal(writes.length, 2);
    for (const write of writes) {
      assert.equal(write.icon.type, 'emoji');
      assert.ok(write.icon.emoji);
      assert.equal(write.cover.type, 'external');
      assert.match(write.cover.external.url, /^https:\/\/images\.unsplash\.com\//);
    }
    assert.deepEqual(randomPageAppearance(() => 0), {
      iconEmoji: '📅',
      coverUrl: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1600&q=80',
    });
  } finally {globalThis.fetch=original;}
});

test('backfill appearance updates only pages missing icon or cover', async () => {
  const original = globalThis.fetch;
  try {
    const pages = {
      [ROOT]: { id: ROOT, icon: null, cover: null },
      [MONTH]: { id: MONTH, icon: {type: 'emoji', emoji: '📅'}, cover: null },
      [DAY]: { id: DAY, icon: null, cover: {type: 'external', external: {url: 'existing'}} },
    };
    const updates = [];
    globalThis.fetch = async (rawUrl, opts) => {
      const url = new URL(rawUrl);
      const pageMatch = url.pathname.match(/^\/v1\/pages\/(\w+)$/);
      if (pageMatch && opts.method === 'GET') return Response.json(pages[pageMatch[1]]);
      const childMatch = url.pathname.match(/^\/v1\/blocks\/(\w+)\/children$/);
      if (childMatch) {
        const results = childMatch[1] === ROOT
          ? [{id: MONTH, type: 'child_page', child_page: {title: 'November 2026'}}]
          : childMatch[1] === MONTH
            ? [{id: DAY, type: 'child_page', child_page: {title: 'November 3, 2026'}}]
            : [];
        return Response.json({results, has_more: false, next_cursor: null});
      }
      if (opts.method === 'PATCH' && pageMatch) {
        updates.push({id: pageMatch[1], body: JSON.parse(opts.body)});
        return Response.json({id: pageMatch[1]});
      }
      return new Response('unsupported', {status: 404});
    };

    await backfillPageAppearances({token: 'fake', rootPageId: ROOT});
    assert.equal(updates.length, 2);
    assert.deepEqual(updates.map(update => update.id).sort(), [MONTH, DAY].sort());
    assert.ok(updates.find(update => update.id === MONTH).body.cover);
    assert.ok(!updates.find(update => update.id === MONTH).body.icon);
    assert.ok(updates.find(update => update.id === DAY).body.icon);
    assert.ok(!updates.find(update => update.id === DAY).body.cover);
  } finally {globalThis.fetch=original;}
});
