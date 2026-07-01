import fs from "fs";
const html = fs.readFileSync("insivumeh_geo.html", "utf8");

const markers = html.split("L.circleMarker(").slice(1);
const records = [];

for (const markerStr of markers) {
  const coordMatch = markerStr.match(/\[([-\d.]+),\s*([-\d.]+)\]/);
  const tooltipMatch = markerStr.split("bindTooltip")[1];

  if (coordMatch && tooltipMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);

    const magMatch = tooltipMatch.match(/Magnitud:\s*<\/b>([\d.]+)/i);
    const timeMatch = tooltipMatch.match(/Tiempo de Origen:\s*<\/b>([\d-:\s]+)/i);
    const depthMatch = tooltipMatch.match(/Profundidad:\s*<\/b>\s*([\d.]+)/i);
    const idMatch = tooltipMatch.match(/ID:\s*<\/b>([a-z0-9]+)/i);

    if (magMatch && timeMatch && idMatch) {
      records.push({
        lat,
        lon,
        mag: parseFloat(magMatch[1]),
        time: timeMatch[1].trim(), // "2026-06-29 01:30:38"
        depth: depthMatch ? parseFloat(depthMatch[1]) : null,
        id: idMatch[1].trim()
      });
    }
  }
}

console.log("Total INSIVUMEH Records:", records.length);
if (records.length > 0) {
  console.log("First record:", records[0]);

  // Test date conversion (INSIVUMEH is UTC-6)
  const [datePart, timePart] = records[0].time.split(" ");
  const isoString = `${datePart}T${timePart}.000-06:00`;
  console.log("UTC Time:", new Date(isoString).toISOString());
}
