# 🔄 Sessie-handoff — Bug Queue setup

> Dit bestand is bedoeld om in een **nieuwe Claude Code-sessie** direct verder te kunnen.
> Lees dit eerst, voer dan de verificatie onderaan uit.

## 📌 Context / doel

Bugs voor het Vionna Dashboard komen binnen op twee plekken:
- **Slack** (kanaal "VIONNA LISTING DASHBOARD")
- **Een bug-queue API op de DigitalOcean droplet**

Eindbeeld van de mobiele flow:
> Slack-ping → Claude-app → typ **"bug"** → Claude leest de queue zelf → fixt → PR → jij merget.
> Eén woord, geen plakwerk.

## 🌐 De bug-queue endpoint

- **Host:** `188-166-11-177.nip.io` (= IP `188.166.11.177`)
- Dit moet via een netwerk-API de openstaande bugs teruggeven.
- **TODO / nog bevestigen:** exacte pad/endpoint (bv. `/api/bugs`, `/queue`) en of er een **API-key/token** nodig is.

## ⚙️ Status van de netwerk-allowlist (BELANGRIJK)

In de vorige sessie werd de droplet **geblokkeerd door de omgevings-firewall**, niet door de server zelf:

```
HTTP/1.1 403 Forbidden
x-deny-reason: host_not_allowed
Host not in allowlist
```

➡️ Dat betekent: de host moet in de **Network access allowlist** van de cloud-omgeving staan
(claude.ai/code → omgeving → tandwiel → Network access → Custom).

### Checklist als het nog niet werkt
1. **Exacte spelling** in het Custom-veld: `188-166-11-177.nip.io` — géén `http://`, géén `/`, geen spaties. Voeg eventueel óók het kale IP `188.166.11.177` toe.
2. **Juiste omgeving** opgeslagen (die van de Vionna-repo).
3. **Volgorde:** eerst allowlist opslaan → DAARNA pas een nieuwe sessie starten. Een lopende sessie pikt de wijziging niet op.

## ✅ Verificatie in de nieuwe sessie

Laat Claude dit draaien:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code} | deny=%header{x-deny-reason}\n" \
  --max-time 15 "http://188-166-11-177.nip.io"
```

Uitkomst:
- **`HTTP 200` (of een ander niet-403 antwoord, geen `deny=host_not_allowed`)** → 🎉 allowlist werkt, de droplet is bereikbaar. Ga door met de bug-queue uitlezen.
- **`HTTP 403 | deny=host_not_allowed`** → allowlist nog niet actief. Loop de checklist hierboven na.

## 🔁 Werkwijze zodra de queue bereikbaar is

1. Queue uitlezen (endpoint bevestigen).
2. Per bug: oorzaak in de codebase zoeken (backend = Flask/Python in `backend/`, frontend = Next.js in `frontend/`).
3. Fix maken op branch `claude/dashboard-functionality-wGJtT`.
4. Committen & pushen.
5. Terugkoppelen welke bugs opgelost zijn (en welke menselijke validatie vereisen, bv. live Shopify-keys uit `.env`/`tokens.json` die niet in de repo staan).

## 🩹 Fallback (werkt altijd, geen netwerk nodig)

Plak de bug-tekst uit Slack rechtstreeks in de sessie → Claude fixt direct.
