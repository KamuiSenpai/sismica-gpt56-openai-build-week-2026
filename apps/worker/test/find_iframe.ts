import fs from "fs";
const html = fs.readFileSync("insivumeh_mapa.html", "utf8");
console.log(html.match(/iframe.*?src=\"([^\"]*)\"/ig));
