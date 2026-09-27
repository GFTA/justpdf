# Pass-Uno

Uno im Browser für Android und iOS. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code
  (oder geben den 4-Buchstaben-Code ein). Jeder sieht nur seine eigenen Karten, und
  oben, wie viele Karten die anderen noch haben. Braucht den kleinen Server unten.
- **Ein Handy für alle**: Das Handy wird herumgereicht, zwischen den Zügen erscheint
  ein Sichtschutz. Läuft auch ohne Server, als einzelne HTML-Datei.

Gespielt wird mit dem Finger: Karte auf den Ablagestapel ziehen, um sie zu legen,
vom verdeckten Stapel zur Hand ziehen (oder antippen), um eine Karte aufzunehmen.

Regeln: Aussetzen, Richtungswechsel (zu zweit = Aussetzen), +2, Farbwahl, +4,
gezogene Karte direkt legen oder behalten, **UNO!**-Knopf mit 2 Strafkarten bei
Vergessen, Punktezählung bis 500 / 250 / eine Runde. 2–10 Spieler.

## Auf dem HP Mini installieren

Der Server ist ein einzelnes Node.js-Programm (`server.js`) ohne Datenbank. Spielstände
landen in `data/rooms.json`, damit ein Neustart laufende Runden nicht verliert.

### Mit Docker (empfohlen)

```sh
git clone -b claude/web-uno-mobile-731sse https://github.com/GFTA/justpdf.git
cd justpdf/uno
docker compose up -d --build
```

Der Container startet nach einem Neustart des Mini-PCs von selbst
(`restart: unless-stopped`). Aktualisieren: `git pull && docker compose up -d --build`.

### Über einen Cloudflare-Tunnel (von überall erreichbar, mit HTTPS)

Läuft auf dem Mini-PC schon ein `cloudflared`-Container, hängt sich Pass-Uno in dessen
Docker-Netzwerk. Im Tunnel zeigt dann ein Hostname (hier `uno.cool-kidz.net`) auf
`http://pass-uno:8080`.

```sh
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # docker inspect cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ist Port 8080 auf dem Mini-PC schon belegt, zusätzlich `UNO_PORT=8088` in `.env`
eintragen (betrifft nur den Zugriff direkt im WLAN).

### Ohne Docker (Linux mit systemd)

```sh
sudo apt install nodejs npm        # Node.js 18 oder neuer
sudo mkdir -p /opt/pass-uno
sudo cp -r server.js package.json package-lock.json public /opt/pass-uno/
cd /opt/pass-uno && sudo npm ci --omit=dev
sudo cp ~/justpdf/uno/deploy/pass-uno.service /etc/systemd/system/
sudo systemctl enable --now pass-uno
```

Unter Windows: Node.js installieren, im Ordner `uno` einmal `npm ci`, dann
`node server.js`. Beim ersten Start fragt Windows, ob die Firewall den Zugriff im
privaten Netzwerk erlauben soll: mit Ja bestätigen.

### Spielen

Beim Start schreibt der Server die Adresse ins Log (`docker compose logs`), etwa

```
Pass-Uno läuft auf Port 8080
  im WLAN öffnen: http://192.168.178.20:8080
```

Im Docker-Container steht dort die interne Container-Adresse; nimm stattdessen die
IP des Mini-PCs (`hostname -I`). Diese Adresse auf dem ersten Handy öffnen, Raum
erstellen, die anderen scannen den QR-Code. Alle Handys müssen im selben WLAN sein wie
der Mini-PC. Tipp: im Router dem Mini-PC eine feste IP geben.

Einstellungen über Umgebungsvariablen: `PORT` (Standard 8080), `HOST` (Standard
0.0.0.0), `DATA_DIR` (Standard `./data`).

Über normales `http://` im Heimnetz funktioniert das Spiel vollständig. Nur zwei Extras
brauchen HTTPS: „Bildschirm bleibt an“ und die Installation als Offline-App auf dem
Home-Bildschirm. Wer das will, stellt einen Reverse-Proxy mit Zertifikat davor
(z. B. Caddy oder Tailscale Serve).

## Entwicklung

```sh
npm install
npm test              # Regel-Engine und Server-Protokoll
npm start             # http://localhost:8080
npm run build:single  # dist/pass-uno.html: „Ein Handy für alle“ als einzelne Datei
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Spielregeln, läuft im Browser und auf dem Server |
| `public/app.js` | Oberfläche, Drag-and-drop, Online-Verbindung |
| `public/index.html` | Layout und Stil |
| `server.js` | Webserver und WebSocket-Räume |

„Uno“ ist eine Marke von Mattel; dieses Projekt ist eine inoffizielle Umsetzung für
den privaten Spieleabend.
