# CampusDrop — Partage P2P anonyme

## Fonctionnement
- Aucun compte, aucune inscription
- Pseudo anonyme généré automatiquement à chaque visite
- Transfert direct entre navigateurs (WebRTC DataChannel)
- Fallback automatique via TURN si le P2P direct est bloqué
- Compatible réseaux universitaires et d'entreprise (TURN TLS port 443)

## Stack
Backend : Node.js + Express + Socket.IO (signaling uniquement)
Frontend : HTML/CSS/JS vanilla + SimplePeer
TURN : ExpressTURN (cloud géré, port 443 TLS)

## Démarrage local
```
npm install
node server.js
```
→ http://localhost:3000

## Déploiement Railway
- Variables d'env : PORT (auto), FRONTEND_ORIGIN (*)
- Start command : node server.js

## Configuration TURN (obligatoire pour les réseaux restrictifs)
1. Créer un compte gratuit sur https://www.expressturn.com
2. Récupérer le host, username et credential dans le dashboard
3. Dans `app.js`, remplacer les 3 placeholders :
   - `EXPRESSTURN_HOST`
   - `EXPRESSTURN_USERNAME`
   - `EXPRESSTURN_CREDENTIAL`

## Pourquoi ça marche sur les réseaux universitaires
Le mode `turns:HOST:443?transport=tcp` fait transiter les données
WebRTC sur le port 443 en TLS, indiscernable du trafic HTTPS normal.
Les firewalls universitaires ne peuvent pas le bloquer sans couper
l'accès à tous les sites web en HTTPS.
