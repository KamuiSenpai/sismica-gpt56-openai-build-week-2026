import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: 'postgres://postgres:postgres@localhost:5433/sismica'
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT relname as table_name, n_live_tup as row_count
    FROM pg_stat_user_tables
    ORDER BY n_live_tup DESC;
  `);
  console.table(res.rows);
  
  // also get the exact count of the most populated table just in case stats are not up to date
  if (res.rows.length > 0) {
      const topTable = res.rows[0].table_name;
      const countRes = await client.query(`SELECT COUNT(*) FROM ${topTable}`);
      console.log(`Exact count of ${topTable}:`, countRes.rows[0].count);
  }

  await client.end();
}

run().catch(console.error);
