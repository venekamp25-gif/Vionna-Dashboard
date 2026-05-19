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
├── publish-update.bat    ← push nieuwe versie naar GitHub
└── README.md
```

## 🚀 Lokaal draaien

1. Dubbelklik `start.bat`
2. Dashboard opent op http://localhost:5000

## 🔄 Update uitrollen

1. Dubbelklik `publish-update.bat`
2. Versienummer wordt verhoogd, alles gepusht naar GitHub

## 🛣 Roadmap

- [x] HTML/Flask MVP (huidige situatie)
- [ ] Fase 1: Repo herstructurering
- [ ] Fase 2: Next.js frontend opzet
- [ ] Fase 3: UI porten
- [ ] Fase 4: API integratie
- [ ] Fase 5: Login systeem
- [ ] Fase 6: Vercel deploy
- [ ] Fase 7: Backend naar DigitalOcean droplet
