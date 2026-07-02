# Connexion Pennylane → Dashboard CFO Strivia

Ce dossier contient le nécessaire pour synchroniser (manuellement, via un bouton)
les données de facturation Pennylane vers ton dashboard CFO.

## Ce qu'il y a dedans

- `api/pennylane-sync.js` — la fonction serverless qui appelle l'API Pennylane
  en sécurité (ton token n'est jamais exposé au navigateur)
- `public/index.html` — **ton dashboard CFO, déjà câblé** avec le bouton
  "Sync Pennylane" dans la barre latérale (à côté de "Sauvegarder")
- `.env.example` — modèle pour ta variable d'environnement

### Comment fonctionne la synchro

Quand tu cliques sur "Sync Pennylane" :
1. Le dashboard appelle `/api/pennylane-sync`
2. La fonction va chercher toutes tes factures clients dans Pennylane et les
   agrège par client et par mois
3. Le dashboard fait correspondre chaque client Pennylane à un client déjà
   présent dans le dashboard (comparaison par nom, insensible à la casse/accents)
4. Pour les clients reconnus, le CA mensuel (`p[]`) est mis à jour avec les
   montants Pennylane — **les coûts annexes restent en saisie manuelle**,
   Pennylane ne les connaît pas
5. Un message t'indique combien de mois ont été mis à jour, et te liste en
   console (F12) les noms de clients Pennylane qui n'ont pas été reconnus
   (à toi de les créer ou corriger l'orthographe du nom)

## Étapes de déploiement (première fois)

### 1. Créer un compte Vercel
Va sur [vercel.com](https://vercel.com) → "Sign Up" → connecte-toi avec GitHub
(gratuit, quelques clics).

### 2. Créer un repo GitHub avec ces fichiers
- Crée un nouveau repo (ex: `strivia-cfo-dashboard`)
- Mets-y tout le contenu de ce dossier tel quel : `api/`, `public/`
  (qui contient déjà ton `index.html` câblé), et `package.json`

### 3. Importer le projet dans Vercel
- Dans Vercel : "Add New" → "Project" → sélectionne ton repo GitHub
- Vercel détecte automatiquement le dossier `api/` comme fonctions serverless
- Clique "Deploy"

### 4. Ajouter ton token Pennylane
- Dans le projet Vercel : Settings → Environment Variables
- Ajoute `PENNYLANE_API_TOKEN` = ton token (généré dans Pennylane >
  Paramètres > Connectivité)
- Redéploie (Deployments → ⋯ → Redeploy) pour que la variable soit prise en compte

### 5. Tester
- Ouvre ton dashboard à l'URL Vercel (ex: `https://strivia-cfo.vercel.app`)
- Clique sur "Synchroniser Pennylane"
- Vérifie dans la console navigateur (F12) que les données arrivent bien

## Sécurité

- Le token Pennylane ne doit **jamais** apparaître dans le code du dashboard
  ni dans un commit Git — uniquement dans les variables d'environnement Vercel.
- Si tu penses avoir exposé un token par erreur, révoque-le immédiatement
  depuis Pennylane (Paramètres > Connectivité) et regénères-en un nouveau.
