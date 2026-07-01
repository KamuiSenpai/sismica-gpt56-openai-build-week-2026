import { chromium } from "playwright";
import fs from "fs";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to INSIVUMEH Geo Map...");
  try {
    await page.goto("https://geo.insivumeh.gob.gt/MAPA_SISMOS/", { waitUntil: "networkidle", timeout: 20000 });
    const content = await page.content();
    fs.writeFileSync('insivumeh_geo.html', content);
    console.log('insivumeh_geo.html saved', content.length);
  } catch(e) { console.log("INSIVUMEH Geo error", e.message) }

  await browser.close();
}
run();
