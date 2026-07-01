import fs from "fs";
const html = fs.readFileSync("../../snet_reportados.html", "utf8");

const dateStr = html.match(/Fecha:\s*(.*?)</)?.[1];
const timeStr = html.match(/Hora Local:\s*(.*?)</)?.[1];
const latStr = html.match(/Latitud\s*\(N\):\s*(.*?)</)?.[1];
const lonStr = html.match(/Longitud\s*\(O\):\s*(.*?)</)?.[1];
const locStr = html.match(/Localizacion:\s*(.*?)</)?.[1];
const depthStr = html.match(/Profundidad:\s*(.*?) km/)?.[1];
const magStr = html.match(/Magnitud:\s*(.*?)</)?.[1];

console.log({ dateStr, timeStr, latStr, lonStr, locStr, depthStr, magStr });

const months = { Enero: "01", Febrero: "02", Marzo: "03", Abril: "04", Mayo: "05", Junio: "06", Julio: "07", Agosto: "08", Septiembre: "09", Octubre: "10", Noviembre: "11", Diciembre: "12" };
if (dateStr && timeStr) {
  const parts = dateStr.trim().split(" "); // "30 de Junio de 2026"
  const day = parts[0].padStart(2, "0");
  const month = months[parts[2] as keyof typeof months];
  const year = parts[4];
  
  const isoString = `${year}-${month}-${day}T${timeStr.trim()}:00.000-06:00`;
  console.log("UTC Time:", new Date(isoString).toISOString());
}
