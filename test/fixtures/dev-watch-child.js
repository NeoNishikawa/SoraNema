/* Proses anak untuk test/dev-watch.test.js: meniru kontrak server.js —
   /lambat baru selesai setelah beberapa saat, dan memakai shutdown.js yang
   sama supaya restart lewat npm run dev tidak memotong respons yang sedang
   berjalan. */
const http = require("node:http");
const { createGracefulShutdown } = require("../../shutdown");

const PORT = Number(process.env.PORT) || 0;
const server = http.createServer((request, response) => {
  if (request.url === "/lambat") {
    setTimeout(() => response.end("selesai"), 1200);
    return;
  }
  response.end("ok");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`FIXTURE_SIAP ${server.address().port} ${process.pid}`);
});

const pemutus = createGracefulShutdown(server, {
  log: (pesan) => console.log(`FIXTURE ${pesan}`),
  setelahListenerDitutup: () => {
    if (typeof process.send === "function") process.send({ type: "listener-ditutup" });
  },
});
process.on("SIGTERM", () => pemutus.matikan("SIGTERM"));
process.on("SIGINT", () => pemutus.matikan("SIGINT"));
process.on("message", (pesan) => {
  if (pesan && pesan.type === "berhenti-anggun") pemutus.matikan("permintaan dev");
});
