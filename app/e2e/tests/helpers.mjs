// Shared steps for the browser tests.

export const PASSWORD = process.env.FIXTURE_PASSWORD || 'guhare-2026';

/** Sign in through the real form and wait until the landing page has loaded. */
export async function signIn(page, username) {
  await page.goto('/login');
  // Already signed in as somebody in this browser: use the switch on purpose.
  if (await page.locator('form[action="/login/switch"]').count()) {
    await page.locator('form[action="/login/switch"] button').click();
    await page.waitForURL(/\/login/);
  }
  await page.fill('#username', username);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(u => !['/login', '/'].includes(new URL(u).pathname));
  await page.waitForLoadState('domcontentloaded');
}

/** A small but genuine PDF with a dark rectangle on it, so a drawn page has ink. */
export function inkPdf() {
  const content = '0 0 0 rg 40 40 120 120 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  // A comment line that differs every call: the server refuses the same file twice.
  let out = `%PDF-1.4\n%${Math.random().toString(36).slice(2)}\n`;
  const offsets = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const mark = () => Math.random().toString(36).slice(2, 9);

/** Register a letter as the signed-in person and return its id. */
export async function registerLetter(page, subject) {
  await page.goto('/registry/new');
  await page.fill('#subject', subject);
  await page.fill('#sender_name', `نێردەری تاقیکردنەوە ${mark()}`);
  await page.click('form[data-similar-form] button[type=submit]');
  // The "this looks familiar" panel may stop the first press; pressing again is
  // the clerk saying they looked.
  if (await page.locator('input[name="confirm_similar"]').count()) {
    await page.click('form[data-similar-form] .row button[type=submit]');
  }
  await page.waitForURL(/\/documents\/\d+/);
  return Number(/\/documents\/(\d+)/.exec(page.url())[1]);
}
