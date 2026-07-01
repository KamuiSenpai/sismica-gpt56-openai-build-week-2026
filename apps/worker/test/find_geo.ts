import fs from "fs";
const html = fs.readFileSync("insivumeh_geo.html", "utf8");

const start = html.indexOf("geo_json_");
if (start > -1) {
  const substr = html.substring(start, start + 3000);
  console.log(substr);
}
