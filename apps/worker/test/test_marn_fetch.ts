import { marnProvider } from "../src/providers/marnProvider.js";
async function run() {
  const events = await marnProvider.fetchEvents();
  console.log("Fetched events:", events.length);
  if (events.length > 0) {
    console.log(events[0].event);
  }
}
run();
