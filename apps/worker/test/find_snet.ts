import fs from "fs";
import path from "path";
const html = fs.readFileSync(path.resolve("../../snet.html"), "utf8");
const links = html.match(/href="([^"]*sismo[^"]*)"/gi) || [];
console.log([...new Set(links)]);
