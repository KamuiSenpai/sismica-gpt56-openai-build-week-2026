import { readFile } from "node:fs/promises";

type PayloadKind = "snapshot" | "origin";

async function main() {
  const [kind, filePath] = process.argv.slice(2) as [PayloadKind | undefined, string | undefined];
  if (!kind || !filePath || !["snapshot", "origin"].includes(kind)) {
    throw new Error("Usage: npm run seismic:publish -- <snapshot|origin> <payload.json>");
  }

  const token = process.env.SEISMIC_ENGINE_TOKEN;
  if (!token) throw new Error("SEISMIC_ENGINE_TOKEN is required");
  const apiBaseUrl = process.env.SEISMIC_ENGINE_API_URL ?? "http://localhost:3000";
  const payload = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  const path =
    kind === "snapshot" ? "/internal/seismic-engine/snapshots" : "/internal/seismic-engine/origins";
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-seismic-engine-token": token
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Adapter request failed (${response.status}): ${responseBody}`);
  }
  console.log(responseBody);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
