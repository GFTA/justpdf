# Pass-Uno

Uno im Browser für **ein** Handy, das am Tisch herumgereicht wird (Android & iOS).
Reines HTML/CSS/JS, keine Abhängigkeiten, kein Server, keine Anmeldung.

- 2–10 Spieler, Namen frei wählbar
- Zwischen den Zügen erscheint ein Sichtschutz „Handy weitergeben an …“ – die Karten
  des nächsten Spielers werden erst nach Antippen gezeigt
- Alle Regeln des Originals: Aussetzen, Richtungswechsel (zu zweit = Aussetzen), +2,
  Farbwahl, +4, Ziehen und gezogene Karte direkt legen, **UNO!**-Knopf mit
  2 Strafkarten bei Vergessen, Punktezählung bis 500 / 250 / eine Runde
- Spielstand wird lokal gespeichert, ein versehentlich geschlossener Tab kann
  fortgesetzt werden
- Bildschirm bleibt an (Wake Lock), läuft nach dem ersten Öffnen auch offline
  (Service Worker) und lässt sich als App zum Homescreen hinzufügen

## Starten

Den Ordner `uno/` auf einen beliebigen statischen HTTPS-Host legen (z. B. GitHub Pages)
und die URL auf dem Handy öffnen. Zum lokalen Ausprobieren:

```sh
cd uno && python3 -m http.server 8000
```

„Uno“ ist eine Marke von Mattel; dieses Projekt ist eine inoffizielle Umsetzung für
den privaten Spieleabend.
