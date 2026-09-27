// Builds dist/pass-uno.html: one self-contained file for the "one phone" mode.
// It opens straight from the phone's downloads, no server needed.
"use strict";
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "..", "public");
let html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
for (const f of ["game.js", "app.js"]) {
  const js = fs.readFileSync(path.join(pub, f), "utf8").replace(/<\/script/gi, "<\\/script");
  html = html.replace(`<script src="${f}"></script>`, () => `<script>\n${js}\n</script>`);
}
// links to files that only exist on the server
html = html.replace(/^<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, "");
fs.mkdirSync(path.join(__dirname, "..", "dist"), { recursive: true });
const out = path.join(__dirname, "..", "dist", "pass-uno.html");
fs.writeFileSync(out, html);
console.log(`geschrieben: ${out} (${Math.round(html.length / 1024)} KB)`);
