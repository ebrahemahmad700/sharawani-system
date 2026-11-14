// Development fixtures: the nine rooms and the staff shown on the approved screens.
//
//   DATABASE_URL_OWNER=... node db/fixtures.mjs
//
// EVERY PERSON HERE IS INVENTED. No real municipal staff member, citizen, plot
// or letter appears anywhere in this repository. Names are taken from the design
// mockups, which were themselves invented. Do not add real people or real
// records to this file.
//
// The rooms are a fixture, not a design. The real list of 25 to 30 rooms does
// not exist yet (open question Q1), and rooms are created through the admin
// screen anyway. These nine are the ones the approved screens show.

import pg from 'pg';
import argon2 from 'argon2';

const url = process.env.DATABASE_URL_OWNER;
if (!url) { console.error('set DATABASE_URL_OWNER'); process.exit(2); }
if (!/localhost|127\.0\.0\.1/.test(url) && !process.env.ALLOW_REMOTE_FIXTURES) {
  console.error('refusing to load fixtures into a non-local database. Set ALLOW_REMOTE_FIXTURES=1 if you really mean it.');
  process.exit(2);
}

const DEV_PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';

const ROOMS = [
  // code,          name,                      number, kind,        due, clerkFwd, sort
  ['REGISTRY',     'ژووری هات و دەرچوو',        null,   'registry',  1, true,  10],
  ['MAYOR',        'ژووری سەرۆکی شارەوانی',     null,   'executive', 2, false, 20],
  ['PLAN_8',       'نەخشەی بنەڕەتی',            '8',    'archive',   3, true,  30],
  ['PLAN_9',       'نەخشەی بنەڕەتی',            '9',    'archive',   3, true,  40],
  ['CONTRACTS_14', 'گرێبەستە گشتییەکان',        '14',   'office',    5, false, 50],
  ['LEGAL',        'ژووری یاسا',                null,   'office',    3, false, 60],
  ['LAND',         'ژووری زەوی و زار',           null,   'office',    4, false, 70],
  ['ACCOUNTS',     'ژووری ژمێریاری',            null,   'office',    4, false, 80],
  ['ADMIN',        'ژووری کارگێڕی',             null,   'office',    2, true,  90],
];

const USERS = [
  // username,   full name,          role,               room code,      head?  deputy?
  ['aram',      'ئارام حەمە',        'mayor',            'MAYOR',        true,  false],
  ['nabaz',     'نەبەز تۆفیق',       'deputy_mayor',     'MAYOR',        false, true ],
  ['shilan',    'شیلان عومەر',       'registry_clerk',   'REGISTRY',     true,  false],
  ['ahang',     'ئاھەنگ نەوزاد',     'room_clerk',       'REGISTRY',     false, false],
  ['hemin',     'هێمن ڕەشید',        'room_head',        'LEGAL',        true,  false],
  ['sakar',     'ساکار ئەحمەد',      'room_clerk',       'LEGAL',        false, true ],
  ['dler',      'دلێر عەلی',         'room_head',        'CONTRACTS_14', true,  false],
  ['rebwar',    'ڕێبوار مستەفا',     'room_clerk',       'CONTRACTS_14', false, true ],
  ['bafrin',    'بەفرین سەلام',      'hr',               'ADMIN',        true,  false],
  ['shne',      'شنە عەبدوڵا',       'room_clerk',       'ADMIN',        false, true ],
  ['karwan',    'کاروان ئیبراهیم',   'archive_clerk',    'PLAN_8',       true,  false],
  ['zhyan',     'ژیان کەریم',        'archive_clerk',    'PLAN_9',       true,  false],
  ['hersh',     'هێرش قادر',         'room_head',        'LAND',         true,  false],
  ['sozan',     'سۆزان مەحمود',      'room_head',        'ACCOUNTS',     true,  false],
  // A directorate head. Missing until the browser audit of 13 September, which is
  // why that role's menu and screens had never been opened by any test.
  ['dana',      'دانا فەرەج',        'directorate_head', 'LAND',         false, false],
  ['itadmin',   'بەڕێوەبەری سیستەم', 'sysadmin',         null,           false, false],
];

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query('BEGIN');

try {
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM app_user');
  if (n > 0 && !process.env.FIXTURE_FORCE) {
    console.log(`${n} users already exist. Set FIXTURE_FORCE=1 to add these anyway.`);
    await client.query('ROLLBACK');
    await client.end();
    process.exit(0);
  }

  const roomId = new Map();
  for (const [code, name, number, kind, due, clerkFwd, sort] of ROOMS) {
    const { rows } = await client.query(
      `INSERT INTO room (code, name, room_number, kind, default_due_days, clerk_can_forward, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [code, name, number, kind, due, clerkFwd, sort]);
    roomId.set(code, rows[0].id);
  }
  console.log(`rooms:  ${roomId.size}`);

  const hash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });

  let count = 0;
  const heads = [], deputies = [];
  for (const [username, fullName, role, code, isHead, isDeputy] of USERS) {
    const { rows } = await client.query(
      `INSERT INTO app_user (username, full_name, password_hash, role, room_id, must_change_password)
       VALUES ($1,$2,$3,$4,$5,false)
       ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [username, fullName, hash, role, code ? roomId.get(code) : null]);
    if (isHead)    heads.push([roomId.get(code), rows[0].id]);
    if (isDeputy)  deputies.push([roomId.get(code), rows[0].id]);
    count++;
  }
  for (const [rid, uid] of heads)    await client.query('UPDATE room SET head_user_id = $2   WHERE id = $1', [rid, uid]);
  for (const [rid, uid] of deputies) await client.query('UPDATE room SET deputy_user_id = $2 WHERE id = $1', [rid, uid]);
  console.log(`users:  ${count}  (${heads.length} heads, ${deputies.length} deputies)`);

  // Form templates. Four of the forms a municipality actually fills in by hand.
  // The wording is invented like everything else here; the real ones get authored
  // through the screen once somebody brings the paper originals.
  const mayorId = (await client.query(`SELECT id FROM app_user WHERE role = 'mayor' LIMIT 1`)).rows[0]?.id;
  const TEMPLATES = [
    {
      name: 'داواکاری مۆڵەت',
      category: 'داواکاری مۆڵەت',
      description: 'فۆڕمی داواکاری مۆڵەتی ساڵانە یان نەخۆشی.',
      fields: [
        ['employee', 'ناوی کارمەند', 'text'],
        ['room', 'ژوور', 'text'],
        ['kind', 'جۆری مۆڵەت', 'text'],
        ['days', 'ژمارەی ڕۆژ', 'number'],
        ['from_date', 'لە بەرواری', 'date'],
        ['to_date', 'تا بەرواری', 'date'],
        ['reason', 'هۆکار', 'textarea'],
        ['deputy', 'جێگر لە کاتی نەبوون', 'text'],
      ],
      body: `<p>بەڕێز بەڕێوەبەری کارگێڕی،</p>
<p>من <b>{{employee}}</b>، کارمەندی <b>{{room}}</b>، داوای <b>{{kind}}</b> بە ماوەی <b>{{days}}</b> ڕۆژ دەکەم،
لە بەرواری <b>{{from_date}}</b> تا <b>{{to_date}}</b>.</p>
<p><b>هۆکار:</b> {{reason}}</p>
<p>لە کاتی نەبوونمدا، بەڕێز <b>{{deputy}}</b> جێگرم دەبێت.</p>`,
    },
    {
      name: 'نامەی ناوخۆیی',
      category: 'نامەی ناوخۆیی',
      description: 'نامەی نێوان ژوورەکان.',
      fields: [
        ['to_room', 'بۆ ژووری', 'text'],
        ['from_room', 'لە ژووری', 'text'],
        ['subject', 'بابەت', 'text'],
        ['body', 'ناوەڕۆک', 'textarea'],
        ['date', 'بەروار', 'date'],
      ],
      body: `<p><b>بۆ:</b> {{to_room}}<br><b>لە:</b> {{from_room}}<br><b>بەروار:</b> {{date}}</p>
<p><b>بابەت: {{subject}}</b></p>
<p>{{body}}</p>`,
    },
    {
      name: 'بڕیاری ئیداری',
      category: 'بڕیار',
      description: 'بڕیاری ئیداری بە ژمارە و بەروار.',
      fields: [
        ['decision_no', 'ژمارەی بڕیار', 'text'],
        ['date', 'بەروار', 'date'],
        ['subject', 'بابەت', 'text'],
        ['body', 'دەقی بڕیار', 'textarea'],
        ['basis', 'بەپێی', 'text'],
      ],
      body: `<p style="text-align:center"><b>بڕیاری ژمارە {{decision_no}}</b><br>بەرواری {{date}}</p>
<p><b>بابەت: {{subject}}</b></p>
<p>بەپێی {{basis}}، بڕیار درا بە:</p>
<p>{{body}}</p>`,
    },
    {
      name: 'ئاگادارکردنەوەی کارمەند',
      category: 'ئاگادارکردنەوە',
      description: 'ئاگادارکردنەوەی فەرمی.',
      fields: [
        ['employee', 'ناوی کارمەند', 'text'],
        ['room', 'ژوور', 'text'],
        ['date', 'بەروار', 'date'],
        ['matter', 'بابەت', 'textarea'],
      ],
      body: `<p>بەڕێز <b>{{employee}}</b> — {{room}}</p>
<p>بەرواری {{date}}</p>
<p>{{matter}}</p>
<p>تکایە ئاگاداربە و پێویستی بکە.</p>`,
    },
  ];

  let templateCount = 0;
  if (mayorId) {
    for (const t of TEMPLATES) {
      const schema = t.fields.map(([name, label, type]) => ({ name, label, type, required: true }));
      await client.query(
        `INSERT INTO template (name, category, description, body_html, field_schema, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO NOTHING`,
        [t.name, t.category, t.description, t.body, JSON.stringify(schema), mayorId]);
      templateCount++;
    }
    console.log(`forms:  ${templateCount}`);
  }

  await client.query(
    `INSERT INTO activity_log (user_id, action, detail) VALUES (NULL, 'ops.migration_applied', $1)`,
    [JSON.stringify({ fixtures: true, rooms: roomId.size, users: count, templates: templateCount })]);

  await client.query('COMMIT');
  console.log(`\nAll fixture accounts use the password: ${DEV_PASSWORD}`);
  console.log('Development only. Every name here is invented.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error('fixtures failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
