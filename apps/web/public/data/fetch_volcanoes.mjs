import fs from 'fs';

async function fetchVolcanoes() {
  const res = await fetch('https://raw.githubusercontent.com/plotly/datasets/master/volcano_db.csv');
  const text = await res.text();
  
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const features = [];
  
  for (let i = 1; i < lines.length; i++) {
    // Regex for CSV split handling quotes
    const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
    
    // In this specific dataset, sometimes locations have commas. Let's just use basic split because we know the structure mostly.
    // Actually, simple split by comma is risky. Let's just parse it manually:
    const cols = [];
    let curr = '';
    let inQuotes = false;
    for (let c = 0; c < lines[i].length; c++) {
      const char = lines[i][c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(curr.trim());
        curr = '';
      } else {
        curr += char;
      }
    }
    cols.push(curr.trim());

    if (cols.length >= 6) {
      const name = cols[1];
      const lat = parseFloat(cols[4]);
      const lon = parseFloat(cols[5]);
      
      if (!isNaN(lat) && !isNaN(lon)) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lon, lat]
          },
          properties: {
            volcanoName: name,
            country: cols[2],
            region: cols[3],
            elev: cols[6],
            type: cols[7],
            status: cols[8]
          }
        });
      }
    }
  }

  const geojson = {
    type: "FeatureCollection",
    features: features
  };

  fs.writeFileSync('volcanoes.geojson', JSON.stringify(geojson, null, 2));
  console.log(`Successfully converted ${features.length} volcanoes to volcanoes.geojson`);
}

fetchVolcanoes().catch(console.error);
