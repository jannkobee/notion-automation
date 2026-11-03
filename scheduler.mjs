import { CronJob } from 'cron';
import { getLocalDate, run } from './standup.mjs';

const schedule = process.env.SCHEDULE_CRON || '0 8 * * 1-5';
const timezone = process.env.TZ || 'Asia/Manila';
let running = false;

async function executeJob(source) {
  if (running) {
    console.log(`Skipped overlapping ${source} job.`);
    return;
  }
  running = true;
  try {
    await run({
      token: process.env.NOTION_TOKEN,
      rootPageId: process.env.NOTION_ROOT_PAGE_ID,
      date: getLocalDate(),
    });
    console.log(`Scheduled job completed successfully (${source}).`);
  } catch (error) {
    console.error(`Scheduled job failed (${source}): ${error.message}`);
  } finally {
    running = false;
  }
}

console.log(`Starting Notion stand-up scheduler at ${schedule} (${timezone}).`);
await executeJob('startup');

const job = new CronJob(schedule, () => executeJob('cron'), null, true, timezone);

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping scheduler.`);
  job.stop();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
