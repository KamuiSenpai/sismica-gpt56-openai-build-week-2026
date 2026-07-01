import { insivumehProvider } from "../src/providers/insivumehProvider.js";
async function run() {
  const events = await insivumehProvider.fetchEvents();
  console.log("Fetched events:", events.length);
  if (events.length > 0) {
    console.log(events[0].event);
  }
}
run();
