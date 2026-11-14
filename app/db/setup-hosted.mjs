// Role setup for a managed Postgres: Neon, Vercel Postgres, Supabase, RDS.
//
//   DATABASE_URL_OWNER=postgres://... \
//   APP_PASSWORD=... READONLY_PASSWORD=... node db/setup-hosted.mjs
//
//   DATABASE_URL_OWNER=postgres://... node db/setup-hosted.mjs --verify
//
// Run this once, before db/migrate.mjs, then the migrations grant to the roles
// it creates.
//
// Why this exists at all. db/migrations/0000_roles.sql needs a superuser: it
// creates a database, and it creates docsys_jobs with BYPASSRLS. No managed
// provider grants superuser, so that file cannot run there. This does the same
// job within what a managed provider allows, and the differences are:
//
//   * No CREATE DATABASE. The provider already made one.
//
//   * No BYPASSRLS role. The nightly jobs connect as the table owner instead,
//     which bypasses row-level security for the same reason BYPASSRLS would:
//     the tables are not marked FORCE ROW LEVEL SECURITY. That is deliberate and
//     documented in 0110_helper_functions.sql; do not "fix" it.
//
//   * Settings are attached to roles rather than to the database, because
//     ALTER DATABASE is usually refused.
//
// The one thing that matters more than anything else here: the web application
// must connect as docsys_app, which owns nothing. If it connects as the owner,
// row-level security stops applying, IT can read every letter, and no screen
// anywhere will tell you. --verify checks exactly that.

import pg from 'pg';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('set DATABASE_URL_OWNER'); process.exit(2); }

const verifyOnly = process.argv.includes('--verify');
const client = new pg.Client({ connectionString: url });
await client.connect();

const q = (sql, params) => client.query(sql, params);

// A role name is not a parameter in Postgres DDL, so it cannot be bound. These
// are fixed literals in this file and never come from input; the passwords, which
// do come from the environment, are bound properly with format(%L).
const APP = 'docsys_app';
const RO = 'docsys_readonly';
const JOBS = 'docsys_jobs';
const OWNER = 'docsys_owner';
const BACKUP = 'docsys_backup';

async function roleExists(name) {
  const { rows } = await q('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  return rows.length > 0;
}

async function setup() {
  const appPw = process.env.APP_PASSWORD;
  const roPw = process.env.READONLY_PASSWORD;
  if (!appPw || !roPw) {
    console.error('set APP_PASSWORD and READONLY_PASSWORD');
    console.error('generate them with: openssl rand -hex 24');
    process.exit(2);
  }

  // Fail with a sentence rather than a raw Postgres error. Every managed provider
  // gives its main role CREATEROLE; a plain owner role created by hand does not
  // have it, and that is the usual reason this script stops here.
  const { rows: [me] } = await q(
    `SELECT current_user AS name, rolcreaterole, rolsuper
       FROM pg_roles WHERE rolname = current_user`);
  if (!me.rolcreaterole && !me.rolsuper) {
    console.error(`${me.name} cannot create roles, so this script cannot set up the other two.`);
    console.error('Connect as the provider\'s main role (Neon, Supabase and RDS all grant it CREATEROLE),');
    console.error(`or grant it: ALTER ROLE ${me.name} CREATEROLE;`);
    process.exit(2);
  }

  console.log('extensions');
  for (const ext of ['pg_trgm', 'pgcrypto', 'btree_gin']) {
    try { await q(`CREATE EXTENSION IF NOT EXISTS ${ext}`); console.log(`  ${ext} ok`); }
    catch (e) { console.error(`  ${ext} FAILED: ${e.message}`); throw e; }
  }

  // docsys_jobs, docsys_backup and docsys_owner are created too, even though on a
  // managed host nothing connects as any of them: the provider's own role owns the
  // tables and the nightly jobs use it. The migrations grant to both by
  // name, and a GRANT to a role that does not exist stops the migration dead. They
  // They exist to satisfy statements that name them. 0120 has
  // ALTER DEFAULT PRIVILEGES FOR ROLE docsys_owner, which stops the whole migration
  // dead if that role is absent, and the grants name docsys_jobs. Do not point
  // DATABASE_URL_JOBS at docsys_jobs here: it cannot be given BYPASSRLS without a
  // superuser, and the seal has to see every row. Use the owner connection.
  console.log('roles');
  for (const [name, pw] of [[APP, appPw], [RO, roPw], [JOBS, appPw], [BACKUP, appPw], [OWNER, appPw]]) {
    // The casts are required: format() is variadic "any", so without them
    // Postgres cannot infer a parameter's type and refuses the statement. %I and
    // %L do the quoting, which is why the password never has to be interpolated
    // into SQL by hand.
    const existed = await roleExists(name);
    const verb = existed ? 'ALTER' : 'CREATE';
    const { rows } = await q(
      `SELECT format('${verb} ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS stmt`, [name, pw]);
    await q(rows[0].stmt);
    console.log(`  ${name} ${existed ? 'already existed, password reset' : 'created'}`);

    // BYPASSRLS and SUPERUSER can only be granted or revoked by a superuser, so a
    // managed provider's role cannot clear them even when it created the role.
    // A freshly created role has neither, so the right move is to check rather
    // than to set: if either is somehow present, this database is not safe for
    // letters and saying so loudly beats failing to fix it quietly.
    const { rows: [attr] } = await q(
      'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1', [name]);
    if (attr.rolbypassrls || attr.rolsuper) {
      console.error(`\n  ${name} has ${attr.rolsuper ? 'SUPERUSER' : 'BYPASSRLS'}.`);
      console.error('  Row-level security would not apply to it, which means IT could read every letter.');
      console.error(`  A superuser must run: ALTER ROLE ${name} NOSUPERUSER NOBYPASSRLS;`);
      process.exit(2);
    }

    // Not security-critical, so a provider that refuses these is only a warning.
    try { await q(`ALTER ROLE ${name} NOCREATEDB NOCREATEROLE`); }
    catch (e) { console.log(`  (could not clear CREATEDB/CREATEROLE on ${name}: ${e.message})`); }
  }

  // ALTER DEFAULT PRIVILEGES FOR ROLE docsys_owner is refused unless the role
  // running it is a member of that role. On a self-hosted install the migrations
  // run as docsys_owner itself and the question never arises; on a managed host
  // they run as the provider's role, so membership has to be granted explicitly.
  try {
    await q(`GRANT ${OWNER} TO current_user`);
    console.log(`  membership of ${OWNER} granted, so the default-privilege statements can run`);
  } catch (e) {
    console.log(`  (could not grant ${OWNER} membership: ${e.message})`);
  }

  // Role settings. 0000_roles.sql puts most of these on the database, which a
  // managed provider will refuse, so they go on the roles instead and mean the
  // same thing. Some providers refuse that too, so each one is attempted
  // separately and a refusal is reported rather than fatal: none of these is the
  // security boundary. The grants are, and the migrations set those.
  console.log('role settings');
  const missed = [];
  const trySet = async (role, setting) => {
    try { await q(`ALTER ROLE ${role} SET ${setting}`); console.log(`  ${role}: ${setting}`); }
    catch (e) { console.log(`  ${role}: ${setting}  REFUSED (${e.message})`); missed.push([role, setting]); }
  };

  await trySet(RO, `default_transaction_read_only = on`);
  await trySet(RO, `statement_timeout = '8s'`);
  await trySet(APP, `statement_timeout = '30s'`);
  for (const role of [APP, RO]) {
    await trySet(role, `timezone = 'Asia/Baghdad'`);
    await trySet(role, `"pg_trgm.similarity_threshold" = 0.25`);
  }

  if (missed.length) {
    console.log(`\n${missed.length} setting(s) were refused by this provider.`);
    console.log('Put them on the connection string instead, for example:');
    console.log('  ...&options=-c%20statement_timeout%3D8s%20-c%20pg_trgm.similarity_threshold%3D0.25');
    console.log('The similarity threshold is the one that changes behaviour: leave it at the');
    console.log('provider default of 0.3 and fuzzy archive search gets measurably stricter.');
  }

  console.log('\nNow run, in this order:');
  console.log('  node db/migrate.mjs        (as DATABASE_URL_OWNER, grants to the roles above)');
  console.log('  node db/fixtures.mjs       (only if you want the invented test data)');
  console.log('  node db/setup-hosted.mjs --verify');
}

async function verify() {
  let bad = 0;
  const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!ok) bad++;
  };

  console.log('--- the roles ---');
  for (const name of [APP, RO]) {
    const { rows } = await q(
      'SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = $1', [name]);
    if (!rows.length) { check(`${name} exists`, false); continue; }
    const r = rows[0];
    check(`${name} cannot bypass row-level security`, r.rolbypassrls === false);
    check(`${name} is not a superuser`, r.rolsuper === false);
    check(`${name} cannot create roles`, r.rolcreaterole === false);
  }

  console.log('\n--- ownership ---');
  const { rows: owned } = await q(`
    SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND tableowner IN ($1, $2)`, [APP, RO]);
  check('the application role owns no tables (owners bypass RLS)', owned[0].n === 0,
        `${owned[0].n} owned`);

  console.log('\n--- row-level security is on where it matters ---');
  // Every table that carries something about a letter, a company or a person.
  // A table added without a policy is open to every role the application uses,
  // so this list has to grow with the schema rather than be a snapshot of it.
  const mustHaveRls = [
    'document', 'routing_step', 'attachment', 'file_blob',
    'document_note',        // remarks about a letter follow the letter's rule
    'document_track',       // the PIN behind the public page
    'dispatch_manifest', 'dispatch_item',
    'company', 'company_document', 'company_file',
    'archive_file', 'document_archive_file',
    'notification',         // private to its recipient, with no exception
    'push_subscription',    // which browser belongs to which person
  ];
  for (const t of mustHaveRls) {
    const { rows } = await q(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`, [t]);
    check(`${t} has row-level security enabled`, rows[0]?.relrowsecurity === true);
  }

  console.log('\n--- the log is still append-only ---');
  const { rows: trg } = await q(`
    SELECT count(*)::int AS n FROM pg_trigger
     WHERE tgrelid = 'activity_log'::regclass AND NOT tgisinternal`);
  check('activity_log still has its guard triggers', trg[0].n > 0, `${trg[0].n} trigger(s)`);

  console.log(bad ? `\n${bad} CHECK(S) FAILED — do not put real records in this database` : '\nthe hosted database is set up correctly');
  return bad === 0;
}

try {
  if (!verifyOnly) await setup();
  const ok = verifyOnly ? await verify() : true;
  await client.end();
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error('failed:', err.message);
  await client.end();
  process.exit(1);
}
