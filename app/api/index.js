/*
 * Serverless entry point.
 *
 * The platform owns the HTTP listener, so this hands it the Express app and
 * nothing else. src/server.mjs sees the VERCEL environment variable and skips
 * its own app.listen(), which is the only difference between running here and
 * running on a municipal server.
 *
 * Everything that makes this deployment different from the normal one is
 * environment, not code: FILE_STORAGE=pg so uploads survive, SECURE_COOKIES=true
 * because there is TLS in front, and CRON_SECRET so the nightly jobs can be
 * called over HTTP. See ../../DEPLOY-VERCEL.md.
 */

export { default } from '../src/server.mjs';
