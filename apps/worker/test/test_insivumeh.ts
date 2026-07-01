import fs from "fs";
const html = fs.readFileSync("insivumeh_geo.html", "utf8");

const startIdx = html.indexOf('{"type": "FeatureCollection"');
if (startIdx > -1) {
  const endIdx = html.indexOf(']}', startIdx) + 2;
  const jsonStr = html.substring(startIdx, endIdx) + "}";
  try {
    const data = JSON.parse(jsonStr);
    console.log("Features count:", data.features.length);
    console.log(data.features[0]);
  } catch (e) {
    console.log("Failed to parse JSON:", e.message);
  }
}
