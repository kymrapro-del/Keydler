# Déploiement sur Vercel

Ce document donne à Kymra la suite de gestes qui reste à sa charge pour mettre
Nightorder en ligne sur une URL stable, avec WebMCP actif. Rien n'est
supposé : chaque étape dit où cliquer et ce qu'on doit voir en retour.

L'ordre est contraignant. Inverser 2 et 3 — demander le jeton avant d'avoir
fixé le domaine — oblige à refaire la demande depuis le début : le jeton est
lié à une origine exacte, gravée dedans, non transférable.

---

## 1. Relier le dépôt GitHub à Vercel

1. Rendre le dépôt **public** (condition de recevabilité du concours,
   indépendante de Vercel — voir `docs/plan-developpement.md`, section 5).
2. Sur [vercel.com](https://vercel.com), **Add New… → Project**, importer le
   dépôt GitHub `WebMCP ChatGPT`.
3. Vercel détecte Vite automatiquement. Vérifier que les champs affichés sont :
   - **Framework Preset** : `Vite`
   - **Build Command** : `npm run build`
   - **Output Directory** : `dist`
   - **Install Command** : `npm ci`
4. Ces quatre valeurs sont déjà écrites dans `vercel.json`
   (`buildCommand`, `outputDirectory`, `installCommand`) : `vercel.json`
   prévaut sur ce que montre l'interface si les deux divergent un jour. Elles
   sont redondantes avec la détection automatique aujourd'hui — les fixer par
   fichier plutôt que par clic évite qu'un futur changement de préréglage côté
   Vercel change silencieusement ce qui est construit.
5. **Ne pas déployer tout de suite si le domaine final n'est pas encore choisi**
   — passer à l'étape 2 d'abord. Un premier déploiement sur le domaine
   `*.vercel.app` généré automatiquement ne casse rien, mais le jeton qui
   compte est celui posé sur le domaine qu'on montrera aux juges.

## 2. Choisir un domaine stable, avant toute chose

Un jeton d'origin trial Chrome est **gravé pour une origine exacte**
(schéma + hôte + port). Les URLs de _preview deployment_ de Vercel changent à
chaque commit (`projet-git-hash-compte.vercel.app`) : un jeton posé pour l'une
d'elles ne fonctionnera jamais sur la suivante, et un jeton posé pour le
domaine de production ne fonctionnera **jamais** sur un preview.

Décision à prendre maintenant, avant l'étape 3 :

- **Le domaine de production Vercel** (`Settings → Domains`), soit
  `<nom-du-projet>.vercel.app` — stable tant que le nom du projet ne change
  pas — soit un domaine personnalisé si Kymra en possède un.
- **Le domaine choisi doit être celui montré aux juges.** Toute la
  démonstration, la vidéo, la description de soumission pointent vers cette
  seule adresse.

Si le nom du projet Vercel change après coup, le domaine `*.vercel.app`
change avec lui et le jeton devient invalide sur la nouvelle adresse — refaire
alors l'étape 3 pour la nouvelle origine.

## 3. Obtenir le jeton d'origin trial

Sur [developer.chrome.com/origintrials](https://developer.chrome.com/origintrials) :

1. Chercher l'essai nommé **WebMCP** (ou « Web Model Context Protocol » selon
   le libellé affiché — c'est l'essai qui déverrouille
   `document.modelContext`) dans la liste des essais actifs, et cliquer
   **Register**.
2. **Web Origin** : coller l'origine choisie à l'étape 2, exactement —
   schéma `https://`, hôte, sans chemin ni slash final. Exemple :
   `https://nightorder.vercel.app`.
3. **Third-party matching** : **ne pas cocher**. Cette case autorise le jeton à
   valider une origine _embarquée_ dans une autre (iframe tiers) ; Nightorder
   est servi en top-level, jamais en iframe, et cocher la case
   n'apporterait rien tout en élargissant inutilement la portée du jeton
   accordé.
4. **Expected usage** : usage normal (pas de « third-party origin trial »
   spécial ici).
5. **Durée** : choisir la durée maximale proposée par le formulaire pour cet
   essai (généralement plusieurs mois). La deadline du concours est le
   3 septembre 2026 — n'importe quelle durée standard la couvre large ; le
   seul risque est d'avoir à renouveler le jeton en cours de route si on
   choisit une durée trop courte par erreur.
6. Valider. Le jeton est une chaîne encodée en base64, longue, affichée
   immédiatement sur la page de confirmation et envoyée par courriel.

## 4. Poser le jeton dans Vercel

1. Projet Vercel → **Settings → Environment Variables**.
2. Nom de la variable : **`VITE_WEBMCP_ORIGIN_TRIAL_TOKEN`** — exactement ce
   nom, `vite.config.ts` ne lit que celui-là (préfixe `VITE_` obligatoire pour
   que Vite l'expose à `import.meta.env` / au plugin de build).
3. Valeur : le jeton complet, sans guillemets, sans retour à la ligne.
4. **Scope (Environment)** : cocher **uniquement `Production`.**
   - Ne pas cocher `Preview` : le jeton est gravé pour le domaine de
     production choisi à l'étape 2, et un build de preview le recevrait pour
     construire une page qui ne pourra jamais l'utiliser sur son URL
     `*-git-*.vercel.app`. Ce n'est pas dangereux, seulement inutile — et ça
     économise l'avertissement de build décrit plus bas sur les previews.
   - Ne pas cocher `Development` : le jeton ne sert à rien pour `vercel dev`,
     et le développement local n'en a jamais eu besoin (drapeau
     `chrome://flags/#enable-webmcp-testing`, voir le `README.md`).
5. **C'est une variable de build, pas un secret d'exécution.** Elle est lue
   une seule fois par `vite.config.ts` pendant `npm run build`, écrite en
   clair dans le `<meta http-equiv="origin-trial">` du HTML produit, puis
   servie telle quelle à chaque visiteur. La marquer « secret » dans
   l'interface Vercel ne change rien à sa confidentialité réelle — un jeton
   d'origin trial n'est de toute façon pas sensible : il est visible par
   quiconque ouvre le code source de la page.
6. Redéployer (`Deployments → … → Redeploy`) si un déploiement de production
   existait déjà avant l'ajout de la variable — poser une variable
   d'environnement ne reconstruit pas automatiquement un déploiement existant.

### Ce qui se passe si on l'oublie

Le build ne casse pas. `vite.config.ts` détecte l'absence de
`VITE_WEBMCP_ORIGIN_TRIAL_TOKEN` pendant un `vite build` et imprime un
avertissement rouge, bien visible, dans les logs de build Vercel
(`Deployments → (le déploiement) → Building`) :

```
ATTENTION Aucun VITE_WEBMCP_ORIGIN_TRIAL_TOKEN au moment du build.
```

Sans ce garde-fou, le défaut ne se serait vu qu'en ouvrant DevTools sur le
site en ligne — potentiellement devant un juge. Un déploiement de production
qui affiche cet avertissement dans ses logs de build n'a **aucun outil
WebMCP** exposé, même si la page a l'air normale.

## 5. Vérifier que ça marche vraiment

Ne pas se fier à l'apparence de la page : elle s'affiche identiquement avec ou
sans jeton valide. La seule vérification qui compte se fait dans DevTools.

1. Ouvrir l'URL de **production** (celle de l'étape 2) dans **Chrome ≥ 149**
   ou Brave équivalent — pas besoin d'activer le drapeau
   `chrome://flags/#enable-webmcp-testing` ici : sur une origine déployée avec
   un jeton valide, l'essai s'active sans drapeau. C'est même une façon de
   distinguer les deux causes d'échec possibles (voir plus bas).
2. **DevTools → onglet Application → section WebMCP** (dans la colonne de
   gauche, sous « Background services » ou proche de « Frames » selon la
   version de Chrome).
3. Ce qu'on doit voir si tout fonctionne :
   - La section liste les outils autorisés dans **Settings → Agent tool
     permissions** — quatre outils de lecture par défaut sans tâche active,
     treize outils au total avec une tâche active (voir
     `docs/protocole-webmcp-manuel.md`, vérifications 1 et 2, pour le détail
     exact).
   - Aucune mention d'erreur d'origin trial dans l'onglet **Console**.
4. **DevTools → Console**, exécuter :
   ```js
   document.modelContext
   ```
   Un objet est rendu → l'essai est actif. `undefined` → il ne l'est pas.
5. Si la section WebMCP est vide ou absente, et que `document.modelContext`
   vaut `undefined`, dans l'ordre des causes à éliminer :
   1. **Voir le code source de la page** (`Ctrl+U` ou « Afficher le code
      source ») et chercher `<meta http-equiv="origin-trial"`. Absent → le
      build déployé n'a pas reçu la variable d'environnement (retour à
      l'étape 4), ou le déploiement consulté est un _preview_ et non la
      production (retour à l'étape 2 — vérifier l'URL dans la barre
      d'adresse).
   2. **Présent mais toujours `undefined`** → l'origine du jeton (dans le
      formulaire de l'étape 3) ne correspond pas **exactement** à l'origine
      ouverte dans le navigateur — un `www.` en trop ou en moins, `http`
      au lieu de `https`, ou un port différent suffit à invalider le jeton
      silencieusement. Comparer caractère pour caractère.
   3. **Jeton présent, origine correcte, toujours rien** → l'essai a peut-être
      expiré (vérifier la date choisie à l'étape 3), ou le navigateur utilisé
      est trop ancien (Chrome < 149) ou ne supporte pas WebMCP du tout.
6. Une fois la section WebMCP peuplée : rejouer au moins les vérifications 1
   et 2 de `docs/protocole-webmcp-manuel.md` sur l'URL déployée — le protocole
   a été écrit pour `localhost`, mais s'applique identiquement à une origine
   de production.

## 6. Activer les comptes et la synchronisation privée

Le déploiement Vercel reste pleinement utilisable en mode local. Pour activer
les comptes passwordless, les workspaces privés, la synchronisation et les
connecteurs chiffrés, suivre ensuite
[`docs/cloud-production.md`](cloud-production.md). Cette procédure est séparée
du jeton d'origin trial : Supabase sécurise les données du compte, tandis que le
jeton Chrome active l'interface WebMCP dans le navigateur.

---

## Pourquoi pas un déploiement par GitHub Actions

Aucun workflow de déploiement n'a été ajouté à `.github/workflows/`. Relier le
dépôt à Vercel (étape 1) fait déjà construire et déployer automatiquement
chaque push sur `main` et chaque pull request (en _preview_) via
l'intégration Git native de Vercel. Un second pipeline de déploiement par
Actions ferait double emploi : deux builds concurrents du même commit, un
risque de course si l'un déploie avant que l'autre ait fini de construire, et
une étape de plus à maintenir sans bénéfice — la CI de ce dépôt
(`.github/workflows/ci.yml`) garde son unique rôle, vérifier avant de fusionner,
et laisse Vercel décider seul de ce qui part en ligne.

## Risque non couvert par ce document : le navigateur intégré de ChatGPT

`frame-ancestors 'none'` (posé dans `vercel.json`) interdit à cette page
d'être affichée dans un `<iframe>`, quelle que soit son origine. C'est une
protection standard et justifiée si la page n'a jamais besoin d'être
embarquée. **Mais** si le navigateur intégré de ChatGPT — l'un des deux
canaux d'accès exigés par le règlement du concours — s'avérait rendre les
pages visitées dans un `<iframe>` plutôt que dans un contexte de navigation
de premier niveau (une fenêtre ou un onglet séparé, comme le font les
navigateurs intégrés classiques de type _in-app browser_), cette directive
bloquerait purement et simplement l'affichage de la page dans ce canal-là.

Personne dans cette tâche n'a vérifié empiriquement comment ChatGPT rend une
page externe dans son navigateur intégré. **À tester avant le dépôt** : ouvrir
l'URL de production depuis ChatGPT et confirmer que la page s'affiche. Si elle
ne s'affiche pas et que la console montre une erreur `frame-ancestors`, la
correction est de remplacer `'none'` par l'origine exacte de ChatGPT une fois
connue — jamais par `*` ni par une valeur devinée.
