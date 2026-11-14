// Crop a region of a saved screenshot: node crop.mjs in.png out.png x y w h [scale]
import { chromium } from '@playwright/test';
import { readFileSync } from 'fs';
import { shot } from './lib.mjs';

const [inName, outName, x, y, w, h, scale = '1'] = process.argv.slice(2);
const b64 = readFileSync(shot(inName)).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: Math.round(w * scale), height: Math.round(h * scale) } });
await page.setContent(`<body style="margin:0;overflow:hidden"><div style="width:${w}px;height:${h}px;overflow:hidden;transform:scale(${scale});transform-origin:0 0"><img src="data:image/png;base64,${b64}" style="display:block;margin-left:-${x}px;margin-top:-${y}px"></div></body>`);
await page.waitForTimeout(200);
await page.screenshot({ path: shot(outName) });
await browser.close();
