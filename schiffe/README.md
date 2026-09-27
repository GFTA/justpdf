# Schiffe versenken

Schiffe versenken im Browser für Android und iOS, für **2 bis 4 Spieler**, im selben
Stil wie Pass-Uno. Zwei Spielarten:

- **Jeder sein Handy**: Einer erstellt einen Raum, die anderen scannen den QR-Code
  (oder geben den 4-Buchstaben-Code ein). Jeder sieht nur seine eigene Flotte. Braucht
  den kleinen Server unten.
- **Ein Handy für alle**: Das Handy wird herumgereicht, zwischen den Zügen erscheint
  ein Sichtschutz. Läuft auch ohne Server, als einzelne HTML-Datei.

In beiden Spielarten können **Computer-Gegner** mitspielen, auch allein gegen einen
oder mehrere Computer.

## So funktioniert es mit mehr als zwei Spielern

- **Jeder gegen jeden**: Jeder hat sein eigenes Meer mit eigener Flotte. Wer dran ist,
  tippt oben auf einen Gegner und schießt auf dessen Flotte.
- **Offene Treffer**: Alle Schüsse sind für alle sichtbar. Wer geschickt ist, versenkt
  ein Schiff, das ein anderer schon angeschossen hat. Welches Schiff versenkt wurde,
  erfahren alle.
- **Ausscheiden**: Ist eine Flotte komplett versenkt, scheidet der Spieler aus und
  schaut zu. Wer als Letzter noch Schiffe hat, gewinnt die Runde.
- **Teams 2 gegen 2** (Hausregel, nur zu viert): Platz 1 und 3 gegen Platz 2 und 4.
  Partner sehen gegenseitig ihre Flotten, können sich nicht beschießen und gewinnen
  zusammen.
- Nicht dran? Das große Feld springt automatisch zu dem Meer, auf das gerade
  geschossen wird, bei einem Treffer auf die eigene Flotte vibriert das Handy.

Spielfelder, jedes mit eigener Flotte:

| Feld | Flotte |
| --- | --- |
| **5×5 Swiftplay** | Zerstörer, 2× U-Boot · 8 Sekunden pro Schuss |
| **8×8** schnell | Kreuzer, Zerstörer, 2× U-Boot |
| **10×10** klassisch | Schlachtschiff, Kreuzer, 2× Zerstörer, U-Boot |
| **12×12** groß | Schlachtschiff, 2× Kreuzer, 2× Zerstörer, U-Boot |
| **14×14** Sonderschiffe | Frachter (2×3), Schlachtschiff, Kreuzer, Schnellboot (3 schräg), Zerstörer, 2× U-Boot |
| **16×16** riesig | Flugzeugträger (2×4), Schlachtschiff, Bohrinsel (2×2), Kreuzer, Korvette (4 schräg), Schnellboot (3 schräg), Zerstörer, U-Boot |

Breite Schiffe sind 2 Felder breit, schräge liegen diagonal. Spielziel: eine Runde,
bis 2 oder bis 3 Siege. **Computer-Gegner** in drei Stufen: Leicht (schießt viel
zufällig), Normal, Profi (rechnet aus, wo die restlichen Schiffe am
wahrscheinlichsten liegen).

Aufstellen: Die Flotte liegt zu Beginn zufällig verteilt. Schiffe per **Drag & Drop**
verschieben (auch aus der Leiste unter dem Feld), ein Tippen auf ein Schiff dreht es.
Gelb zeigt, wo es landet, Rot, dass es nicht passt. **Drehen**, **Zufällig** und
**Leeren** helfen. Am Ende der Runde zeigt die Übersicht alle Meere mit allen Schiffen,
auch die nie gefundenen der Gegner.
Schießen: Feld antippen zum Zielen, dann **Feuer!** (oder das Feld nochmal antippen).

**Hausregeln** (Host im Warteraum, bzw. beim Spiel mit einem Handy aufklappbar):
Treffer = nochmal (Standard an) · Salve (so viele Schüsse, wie man noch Schiffe hat) ·
Schiffe dürfen sich berühren (sonst wird das Wasser rund um versenkte Schiffe
automatisch aufgedeckt) · Spezialwaffen (pro Runde eine Bombe, die ein Kreuz aus
5 Feldern trifft, und ein Torpedo, der von links durch eine Reihe läuft, bis er auf
ein Schiff stößt) · Sonar (einmal pro Runde ein 3×3-Feld abhorchen) · Schussuhr
(15 Sekunden pro Schuss, sonst Zufallsschuss) · Teams 2 gegen 2.

**Am Rundenende** gibt es neben allen aufgedeckten Flotten kleine Auszeichnungen:
Scharfschütze (beste Trefferquote), Versenker (meiste Schiffe), Aasgeier (Schiffe
fertig versenkt, die andere angeschossen hatten), Trefferserie und Pechvogel.

**Am Computer** (Desktop-Modus ab 900 px Breite): breites Layout mit großem Zielfeld
und der eigenen Flotte groß daneben, Hover-Effekte, beim Aufstellen folgt das Schiff
der Maus (Rechtsklick dreht). Tasten: Pfeile zielen, Enter feuert, 1–3 wählt den
Gegner, S Sonar, R dreht beim Aufstellen, Esc schließt Fenster.

Mit 2 Spielern liegen am Computer beide Meere groß übereinander wie beim Brettspiel:
oben das Gegnerfeld zum Schießen, unten die eigene Flotte.

**Ansicht**: Das große Feld bleibt immer bei dem Meer, das du angetippt hast. Schüsse
auf andere Meere lassen deren Kärtchen oben kurz aufleuchten (rot bei Treffer), Treffer
auf die eigene Flotte blitzen rot und vibrieren.

**Zuschauen**: Wer einem laufenden Spiel oder einem vollen Raum beitritt, schaut zu
(ohne Flotten zu sehen) und kann im Warteraum mit „Mitspielen“ einen freien Platz
nehmen. **Zielhilfe** (im Menü): dunkelt Felder ab, auf denen keins der übrigen
Schiffe mehr liegen kann. Im Menü steht außerdem der ganze **Spielverlauf** der Runde.
Auf dem Startbildschirm zeigt die **Bilanz**, wer auf diesem Gerät wie oft gewonnen
hat, mit Trefferquote.

Online gibt es **Emoji-Reaktionen** und Schnellnachrichten („Na warte!“, „Gut gespielt!“ …), dazu Töne, Vibration und Konfetti für den Sieger
(im Menü abschaltbar). Der Host kann einen abwesenden Spieler überspringen, jeder kann
aufgeben.

## Auf dem HP Mini installieren

Der Server ist ein einzelnes Node.js-Programm (`server.js`) ohne Datenbank. Spielstände
landen in `data/rooms.json`, damit ein Neustart laufende Runden nicht verliert.
Er läuft problemlos neben Pass-Uno: im WLAN auf Port **8081** statt 8080.

### Mit Docker (empfohlen)

```sh
git clone -b claude/schiffe-versenken-game-4g247z https://github.com/GFTA/justpdf.git
cd justpdf/schiffe
docker compose up -d --build
```

Der Container startet nach einem Neustart des Mini-PCs von selbst
(`restart: unless-stopped`). Aktualisieren: `git pull && docker compose up -d --build`.

### Über einen Cloudflare-Tunnel (von überall erreichbar, mit HTTPS)

Läuft auf dem Mini-PC schon ein `cloudflared`-Container, hängt sich das Spiel in dessen
Docker-Netzwerk. Im Tunnel `debian-main` ist dafür schon eingetragen:
`schiffe.cool-kidz.net` → `http://schiffe:8080` (samt DNS-Eintrag).

```sh
echo "TUNNEL_NETWORK=<netzwerk-von-cloudflared>" > .env   # docker inspect cloudflared
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
```

Ist Port 8081 auf dem Mini-PC schon belegt, zusätzlich `SCHIFFE_PORT=8082` in `.env`
eintragen (betrifft nur den Zugriff direkt im WLAN).

### Ohne Docker (Linux mit systemd)

```sh
sudo apt install nodejs npm        # Node.js 18 oder neuer
sudo mkdir -p /opt/schiffe
sudo cp -r server.js package.json package-lock.json public /opt/schiffe/
cd /opt/schiffe && sudo npm ci --omit=dev
sudo cp ~/justpdf/schiffe/deploy/schiffe.service /etc/systemd/system/
sudo systemctl enable --now schiffe
```

Unter Windows: Node.js installieren, im Ordner `schiffe` einmal `npm ci`, dann
`node server.js`. Beim ersten Start fragt Windows, ob die Firewall den Zugriff im
privaten Netzwerk erlauben soll: mit Ja bestätigen.

### Spielen

Beim Start schreibt der Server die Adresse ins Log (`docker compose logs`), etwa

```
Schiffe versenken läuft auf Port 8080
  im WLAN öffnen: http://192.168.178.20:8080
```

Im Docker-Container steht dort die interne Container-Adresse und Port 8080; nimm
stattdessen die IP des Mini-PCs (`hostname -I`) und Port 8081. Diese Adresse auf dem
ersten Handy öffnen, Raum erstellen, die anderen scannen den QR-Code. Alle Handys
müssen im selben WLAN sein wie der Mini-PC. Tipp: im Router dem Mini-PC eine feste IP
geben.

Einstellungen über Umgebungsvariablen: `PORT` (Standard 8080), `HOST` (Standard
0.0.0.0), `DATA_DIR` (Standard `./data`), `BOT_MS` (Bedenkzeit der Computer-Gegner,
Standard 1100 ms).

Über normales `http://` im Heimnetz funktioniert das Spiel vollständig. Nur zwei Extras
brauchen HTTPS: „Bildschirm bleibt an“ und die Installation als Offline-App auf dem
Home-Bildschirm.

## Entwicklung

```sh
npm install
npm test              # Spielregeln, Computer-Gegner und Server-Protokoll
npm start             # http://localhost:8080
npm run build:single  # dist/schiffe.html: „Ein Handy für alle“ als einzelne Datei
```

| Datei | Inhalt |
| --- | --- |
| `public/game.js` | Spielregeln und Computer-Gegner, läuft im Browser und auf dem Server |
| `public/app.js` | Oberfläche, Aufstellen, Zielen, Online-Verbindung |
| `public/index.html` | Layout und Stil |
| `server.js` | Webserver und WebSocket-Räume |
