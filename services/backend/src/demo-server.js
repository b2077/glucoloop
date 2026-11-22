/** Start the credential-free browser demo on Windows, macOS or Linux.
 * npm run demo imports the backend in test mode, so no environment files,
 * background alert timers or real chat credentials are loaded.
 */
import fs from "node:fs";
const config = JSON.parse(fs.readFileSync(new URL("./demo-config.json", import.meta.url)));
process.env.NODE_ENV = "test";
const { server } = await import("./server.js");
server.listen(config.port, "127.0.0.1", () => {
  console.log(`Simulation demo ready: http://localhost:${config.port}/demo`);
});
