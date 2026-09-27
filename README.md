# Vionna Dashboard

Product import dashboard voor Vionna DK & FR Shopify stores.
Scrapet competitor producten, genereert content via Claude, maakt model-foto's via Higgsfield (Nano Banana), en publiceert naar Shopify met meertaligheid, varianten en metafields.

## 📁 Mapstructuur

```
vionna-dashboard/
├── backend/              ← Python Flask backend
│   ├── server.py
│   ├── requirements.txt
│   ├── index.html        ← huidige HTML dashboard (wordt later vervangen)
│   ├── .env              ← API keys (Shopify, Claude)
│   ├── tokens.json       ← Shopify OAuth tokens
│   └── version.txt
├── frontend/             ← Next.js app (in opbouw)
├── start.bat             ← dubbelklik om dashboard lokaal te starten
├── backend/.env.example  ← voorbeeld-instellingen om lokaal te draaien
└── README.md
```

## 🚀 Lokaal draaien

1. Kopieer `backend/.env.example` naar `backend/.env` en vul je eigen waarden in
2. Dubbelklik `start.bat`
3. Dashboard opent op http://localhost:5000

## 🔄 Update uitrollen

Rechtstreeks naar `main` pushen kan niet meer (branch-regel sinds 2026-08-31).
Elke wijziging gaat via een branch + pull request: de CI moet groen zijn en de
eigenaar merget. Na de merge zetten Netlify en de droplet het binnen ~10 minuten
zelf live. Bij een backend-wijziging hoort een hogere `backend/version.txt`.
Hoe je lokaal draait en een PR maakt staat in `CLAUDE.md` onder
"Working here as a second developer".

Gebruik nooit `git add -A`: in deze map staan `.env` en `tokens.json`.

## 🛣 Roadmap

- [x] HTML/Flask MVP (huidige situatie)
- [ ] Fase 1: Repo herstructurering
- [ ] Fase 2: Next.js frontend opzet
- [ ] Fase 3: UI porten
- [ ] Fase 4: API integratie
- [ ] Fase 5: Login systeem
- [ ] Fase 6: Vercel deploy
- [ ] Fase 7: Backend naar DigitalOcean droplet
