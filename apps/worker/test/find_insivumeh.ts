import fs from "fs";
const html = fs.readFileSync("insivumeh.html", "utf8");
console.log("PDFs:", html.match(/href="[^"]*\.pdf"/gi)?.slice(0, 5));
console.log("Iframes:", html.match(/iframe.*?src="([^"]*)"/gi));
