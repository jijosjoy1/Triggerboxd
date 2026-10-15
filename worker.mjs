import nextWorker from './.open-next/worker.js';
import { runOwnerNotificationSchedule } from './src/lib/owner-schedule.mjs';
export * from './.open-next/worker.js';

export default {
  ...nextWorker,
  async scheduled(_event, env, ctx) {
    await runOwnerNotificationSchedule(nextWorker, env, ctx);
  },
};
