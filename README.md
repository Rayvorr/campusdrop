# CampusDrop

CampusDrop est un service simple de transfert de fichiers temporaire, sans compte.

## Fonctionnement
- Un utilisateur sélectionne un ou plusieurs fichiers.
- Le serveur reçoit les fichiers et les stocke temporairement dans `uploads/`.
- Un code court et un lien direct sont générés.
- Le destinataire ouvre le lien ou saisit le code.
- Les fichiers sont disponibles au téléchargement jusqu'à expiration.
- Un nettoyage automatique supprime les partages expirés.

## Stack
- Backend : Node.js + Express
- Upload : Multer
- Frontend : HTML/CSS/JS vanilla

## Démarrage local
```bash
npm install
npm start
```

Puis ouvrir :
```text
http://localhost:3000
```

Le dossier `uploads/` est créé automatiquement au démarrage et reste ignoré par Git.

## Variables utiles
- `PORT` : port du serveur, fourni automatiquement par Railway
- `PUBLIC_BASE_URL` : URL publique utilisée dans les liens de partage
- `SHARE_TTL_HOURS` : durée de vie des partages, 24 par défaut
- `UPLOAD_DIR` : dossier de stockage temporaire
- `MAX_FILES` : nombre maximum de fichiers par partage, 10 par défaut
- `MAX_FILE_SIZE_MB` : taille max par fichier, 250 Mo par défaut
- `MAX_TOTAL_SIZE_MB` : taille max totale par partage, 500 Mo par défaut
