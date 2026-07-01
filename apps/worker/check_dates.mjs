import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5433/sismica'
});

async function run() {
  await client.connect();
  
  // Fechas (Mínima y Máxima)
  const datesRes = await client.query(`
    SELECT MIN(event_time_utc) as min_date, MAX(event_time_utc) as max_date 
    FROM seismic_events
  `);
  console.log('--- FECHAS ---');
  console.log(`Fecha más antigua: ${datesRes.rows[0].min_date}`);
  console.log(`Fecha más reciente: ${datesRes.rows[0].max_date}`);
  
  // Duplicidad exacta en tabla de eventos
  const dupRes = await client.query(`
    SELECT COUNT(*) as total_events, COUNT(DISTINCT event_id) as unique_ids
    FROM seismic_events
  `);
  console.log('\n--- DUPLICIDAD EXACTA ---');
  console.log(`Total registros en seismic_events: ${dupRes.rows[0].total_events}`);
  console.log(`IDs únicos en seismic_events: ${dupRes.rows[0].unique_ids}`);
  
  // Revisar si hubo uniones/deduplicación (asociaciones)
  const assocRes = await client.query(`
    SELECT COUNT(*) as total_refs, COUNT(DISTINCT event_id) as merged_events
    FROM event_source_refs
  `);
  console.log('\n--- DEDUPLICACIÓN DE FUENTES ---');
  console.log(`Registros crudos obtenidos de las fuentes: ${assocRes.rows[0].total_refs}`);
  console.log(`Eventos unificados finales tras la deduplicación: ${assocRes.rows[0].merged_events}`);
  
  const mergedCount = await client.query(`
    SELECT COUNT(*) as total_merged FROM (
      SELECT event_id FROM event_source_refs GROUP BY event_id HAVING COUNT(*) > 1
    ) as t
  `);
  console.log(`Cantidad de eventos que agrupan información de más de 1 fuente (eliminando duplicados): ${mergedCount.rows[0].total_merged}`);

  await client.end();
}

run().catch(console.error);
