// Serves the page made by make-test-page.ps1 on http://localhost:4317/. It re-reads the file on every request.
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const page = path.join(os.tmpdir(), "biproject-test", "preview.html");

http.createServer((request, response) => {
    if (!fs.existsSync(page)) {
        response.writeHead(404);
        response.end("Run make-test-page.ps1 first.");
        return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(fs.readFileSync(page));
}).listen(4317, "127.0.0.1", () => console.log("test page on http://localhost:4317/"));
