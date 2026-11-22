// Every module that registers scheduled jobs (registerJob in @/lib/cron/registry), one import line
// each. Shared file: re-read it and add your line with the Edit tool only, e.g.
//   import "@/lib/email/jobs";          // emails.flush (frequent)
//   import "@/lib/reviews/jobs";        // reviews.request (daily)
// The cron route, "run now" and listJobStatus load this file through loadJobs() in ./run.ts.
import "server-only";
import "./core-jobs"; // orders.expire, carts.prune, ratelimits.prune, auth.prune
import "@/lib/email/jobs"; // emails.flush (frequent)
import "@/lib/newsletter/jobs"; // newsletter.send (frequent)
import "@/lib/reviews/jobs"; // reviews.request (daily)
import "@/lib/subscriptions/jobs"; // subscriptions.remind, subscriptions.renew (daily)
import "@/lib/seo/jobs"; // seo.indexnow (daily)
import "@/lib/wheel/jobs"; // wheel.remind, wheel.purge (daily)
import "@/lib/panel/media/jobs"; // media.prune-incoming (daily)
