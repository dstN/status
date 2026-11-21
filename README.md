# status

Eine Statusseite für alle Seiten auf dem Netcup-Webspace, auf GitHub Pages und damit unabhängig vom Server: Ist der Webspace weg, zeigt sie das trotzdem.

Alle fünf Minuten fragt `.github/workflows/status.yml` jede Seite aus `domains.txt` in [netcup-deploy](https://github.com/dstN/netcup-deploy) ab. Die Liste pflegst du nur dort, eine Domain pro Zeile. Gezählt wird wie in `uptime.yml` dort: 5xx und keine Antwort (auch ein abgelaufenes Zertifikat) sind ein Ausfall, 401 und 403 nicht, weil Vorschauen hinter einem Passwort liegen. Eine Weiterleitung zählt als Antwort.

## Passwort

Die Seite ist öffentlich, ihre Daten nicht. Der Workflow verschlüsselt den Verlauf mit `STATUS_PASSWORD` (PBKDF2-SHA256 mit 600 000 Runden, dann AES-256-GCM) und legt nur das Ergebnis als `data.json` auf Pages. Die Seite fragt nach dem Passwort und entschlüsselt im Browser; ein falsches Passwort lässt die Entschlüsselung scheitern. Auf Wunsch merkt sich der Browser den abgeleiteten Schlüssel, das Passwort selbst nie.

Wer die `data.json` hat, kann Passwörter offline durchprobieren. Darum ein langes Passwort, etwa vier zufällige Wörter. Wird es geändert, beginnt der Verlauf neu, und jeder Browser muss sich neu anmelden.

Dieses Repository ist öffentlich, damit die Actions-Minuten nichts kosten; alle fünf Minuten wären in einem privaten Repository weit über dem Freikontingent. Öffentlich sind damit auch die Logs: `scripts/pruefen.mjs` gibt keinen Host aus, nur die Zahl der erreichbaren Seiten. Im Repository selbst steht keine Domain.

## Zertifikate

Bei jedem Lauf liest der Workflow das Zertifikat jeder Seite von außen und merkt sich das Ablaufdatum; die Seite zeigt die verbleibenden Tage. Läuft eines in weniger als 21 Tagen ab, schlägt der Lauf fehl und GitHub mailt, danach jede Woche wieder, bis es erneuert ist. Das fängt die Wildcards, die Plesk nicht selbst erneuert (README von netcup-deploy, „Zertifikate“), und jede normale Erneuerung, die schiefging. Ein abgelaufenes Zertifikat ist für die Abfrage keine Antwort und zählt sofort als Ausfall.

## Verlauf

Es gibt keine Commits. Jeder Lauf holt die laufende `data.json` von Pages, entschlüsselt sie, hängt das neue Ergebnis an und legt sie wieder ab. Gehalten werden die letzten 288 Abfragen je Seite (24 Stunden) und je Tag die Zahl der erfolgreichen, ein Jahr lang. Ein Klick auf eine Seite klappt die Balken für 30 Tage, 90 Tage und 12 Monate auf. Eine Seite, die aus `domains.txt` verschwindet, verschwindet mit ihrem Verlauf.

GitHub schaltet geplante Workflows eines öffentlichen Repositories nach 60 Tagen ohne Aktivität ab. Der Job `wach` schaltet ihn deshalb jeden Montag selbst wieder ein.

Fällt eine Seite neu aus, schlägt der Lauf fehl und GitHub schickt die Mail: einmal je Ausfall, nicht alle fünf Minuten. Welche Seite es ist, steht nur auf der Statusseite, weil das Log öffentlich ist. Kommt sie wieder, gibt es keine Mail.

## Einmal einrichten

1. Settings, Pages, Source: „GitHub Actions“.
2. Einen Deploy-Key, mit dem dieser Workflow `domains.txt` aus dem privaten netcup-deploy lesen darf. Nur lesen, nur dieses eine Repository, läuft nicht ab:

   ```sh
   ssh-keygen -t ed25519 -N "" -C "status liest domains.txt" -f status_key
   gh repo deploy-key add status_key.pub -R dstN/netcup-deploy -t "status (lesen)"
   gh secret set DOMAINS_KEY -R dstN/status < status_key
   rm status_key status_key.pub
   ```

3. Das Passwort, ohne dass es in der Shell-History landet (`gh` fragt danach):

   ```sh
   gh secret set STATUS_PASSWORD -R dstN/status
   ```

4. Actions, Status, „Run workflow“. Danach läuft er alle fünf Minuten. Fehlt eines der beiden Secrets, endet der Lauf mit einer Warnung und prüft nichts.

Die Seite liegt unter `https://dstn.github.io/status/`. Geplante Läufe starten bei GitHub oft ein paar Minuten zu spät; steht die letzte Prüfung über 20 Minuten zurück, zeigt die Seite das gelb an.
