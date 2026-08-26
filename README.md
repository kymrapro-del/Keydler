# Cahier de quart

Mémoire de tâche persistante et supervisée, que les agents lisent et écrivent
par WebMCP.

> **État : J2.** Les six outils écrivent dans un cahier versionné et persistant.
> Il n'y a pas encore de tableau de bord : la page servie est un banc d'essai.
> Le plan complet est dans [`docs/plan-developpement.md`](docs/plan-developpement.md).

## Lancer

```bash
npm install
npm run dev
```

La page s'ouvre sur `http://localhost:5173`. Sans WebMCP, elle reste lisible et
explique quoi activer.

## Activer WebMCP

WebMCP est en essai d'origine depuis Chrome 149. En local, aucun jeton n'est
nécessaire :

1. ouvrir `chrome://flags/#enable-webmcp-testing` ;
2. passer le drapeau à **Enabled** ;
3. relancer Chrome, puis recharger la page.

**Brave fonctionne.** Vérifié sur Brave 151 / Chromium 151 sous Linux : le
drapeau existe (`brave://flags/#enable-webmcp-testing`) et les deux surfaces,
`document.modelContext` et `navigator.modelContext`, sont exposées. Inutile
d'installer Chrome.

Le bandeau en haut indique si l'outil est exposé. `localhost` étant un contexte
sécurisé, l'API s'enregistre sans déploiement.

Pour une origine déployée, poser le jeton dans `.env` :

```
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=votre-jeton
```

Il est injecté par script au démarrage, ce qui évite de committer dans
`index.html` un jeton lié à une seule origine.

## Le test du J1

Deux tests distincts. Le premier ne demande aucun agent.

### Test A — l'enregistrement

1. Chrome avec le drapeau activé, page ouverte, bandeau vert.
2. DevTools → onglet **Application** → section **WebMCP**.
3. Sélectionner `resume_task` dans *Available Tools*, cliquer **Run tool**.

L'état figé doit s'afficher, et le compteur de la page s'incrémenter. Cela
prouve que le code est correct — pas qu'un agent appellera l'outil.

### Test B — la découverte par un agent

ChatGPT desktop n'existe pas sous Linux, et n'est pas nécessaire : un pont MCP
expose les outils de la page à n'importe quel client MCP.

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Le paquet `@mcp-b/chrome-devtools-mcp` est à éviter : sa version 3.0.0 est
cassée à la publication — le dossier `build/` vers lequel pointent ses `bin`
n'a jamais été publié.

Le navigateur doit exposer le protocole de débogage. Deux points non évidents :

- le basculement dans `brave://inspect/#remote-debugging` **n'ouvre aucun
  port** ; il faut le drapeau au lancement ;
- Chromium ≥ 136 **refuse** le débogage distant sur le profil par défaut, d'où
  le `--user-data-dir` séparé — qui perd les réglages de `brave://flags`, d'où
  le drapeau de fonctionnalité passé explicitement.

```bash
brave --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-webmcp \
  --enable-features=WebMCP,WebMCPTesting \
  http://localhost:5173
```

La fonctionnalité s'appelle **`WebMCPTesting`** dans Brave 151, alors que
l'aide de `chrome-devtools-mcp` annonce `WebMCP`. Passer les deux.

> **Limite du pont, à ne pas maquiller.** `navigate_page` renvoie la liste
> complète des outils de la page, descriptions comprises, sans qu'on la
> demande. L'agent n'a donc rien à découvrir : on la lui met sous les yeux.
> C'est un chemin plus favorable que le navigateur intégré de ChatGPT, où
> l'agent doit décider d'aller chercher les outils. Un test réussi par ce pont
> ne démontre pas la découverte spontanée.

1. Onglet ouvert dans Chrome, drapeau activé.
2. Conversation neuve, sans aucun historique. Écrire : `continue`.
3. Le compteur de la page doit s'incrémenter.

Puis le décisif : **fermer la conversation**, en ouvrir une vierge, réécrire
`continue`.

> **Critère de sortie.** Dans la conversation neuve, l'agent va chercher les
> outils de la page et appelle `resume_task` de lui-même.

Via le pont, l'agent voit deux outils génériques — `list_webmcp_tools` et
`call_webmcp_tool` — et non les outils de la page directement. C'est un chemin
de découverte réel, mais différent de celui du navigateur intégré de ChatGPT.

### Conventions d'appel réelles

L'implémentation de Chromium 151 diverge de l'IDL publiée sur trois points. Les
trois se manifestent par un `Failed to parse input arguments` peu bavard.

```js
const tools = await document.modelContext.getTools()

await document.modelContext.executeTool(tools[0], '{}')   // ✅ chaîne JSON
await document.modelContext.executeTool(tools[0], {})     // ❌ rejeté
```

- Les arguments d'entrée sont une **chaîne JSON**, pas un objet.
- `executeTool` renvoie une **chaîne** : le `ToolResult` arrive sérialisé.
- `inputSchema` fait l'aller-retour en **chaîne**, même enregistré en objet —
  le navigateur normalise, l'enregistrement n'a pas à changer.

Vérifié le 26 août 2026 sur Brave 151.

### Ce qu'il faut relever ensuite

Ouvrez d'abord le cahier de démonstration depuis la page. Il est construit par
les mutations du domaine, donc reproductible à l'identique sur n'importe quelle
machine — sa forme est verrouillée par `test/seed.test.ts`.

Il porte trois contraintes actives et deux approches rejetées. Un agent qui a
réellement *lu* ce qu'il a reçu :

- annonce l'approche C comme prochaine action ;
- refuse la variante B en citant la rotation des jetons ;
- n'ajoute aucune dépendance.

S'il appelle l'outil mais ignore ces éléments, le problème est dans le format de
restitution. S'il n'appelle pas l'outil, le problème est dans la description —
la reformuler sur les *circonstances* d'appel, pas sur la fonction.

## Ce que le code contient

| Dossier | Rôle |
|---|---|
| `src/domain` | Types, invariants et mutations pures. Aucune dépendance : ni React, ni DOM, ni IndexedDB, ni WebMCP. |
| `src/persistence` | IndexedDB et migrations de schéma. Seule porte vers le stockage. |
| `src/store` | Source de vérité observable, partagée par l'interface et les outils. |
| `src/webmcp` | Adaptateur d'API, descriptions, les six outils, enregistrement singleton. |
| `src/tokens.css` | Jetons visuels neutres — le seul fichier que le design réécrit. |

### Les six outils

| Outil | Entrées | Rôle |
|---|---|---|
| `resume_task` | — | Restitue l'état canonique et la version |
| `log_step` | `action, result, evidence?, next?, based_on_version` | Consigne une étape et son degré de preuve |
| `add_constraint` | `rule, based_on_version` | Consigne permanente, côté agent |
| `reject_approach` | `approach, reason, based_on_version` | Empêche de réessayer ce qui a échoué |
| `add_decision` | `choice, rationale, based_on_version` | Le pourquoi, que tout résumé perd |
| `complete_task` | `summary, based_on_version` | Instantané final, transmissible |

### La supervision humaine

La page permet à l'humain d'intervenir dans l'état pendant que l'agent
travaille :

- **ajouter une contrainte**, marquée `[human]`, qui incrémente la version et
  périme donc celle sur laquelle l'agent croit travailler ;
- **lever ou rétablir** une contrainte — une contrainte levée disparaît de ce
  que `resume_task` restitue ;
- **valider une preuve d'un clic**, seul chemin vers le degré `human_verified`.

La saisie en cours **survit aux écritures de l'agent** : texte, position du
curseur et focus sont reportés à travers le redessin. Sans cela, l'agent
effacerait la contrainte que l'humain est en train de taper contre lui — soit
exactement le moment que ce produit existe pour rendre possible.

### Les trois règles du noyau

1. Toute mutation appliquée incrémente `version`, sans exception.
2. Toute écriture d'agent porte un `based_on_version` ; une divergence est
   **refusée**, jamais fusionnée :

```
STALE STATE
You are attempting to log work based on task state v1.
Current state is v5. Call resume_task before continuing.
```

3. Une écriture humaine est autoritaire : sans version, jamais refusée. C'est
   elle qui périme celle de l'agent — toute la supervision tient là.

## Vérifier

```bash
npm run check
```

Types, 26 tests d'invariants, build de production.

### Deux règles qui ne bougeront pas

**L'enregistrement ne vit jamais dans un composant.** Il s'exécute une fois, à
l'import. Quand React arrivera, son mode strict montera les composants deux
fois en développement : un `registerTool` appelé depuis un `useEffect`
produirait des outils dédoublés puis détruits.

**Aucune valeur visuelle en dur hors de `src/tokens.css`.** Réécrire ce fichier
suffit à changer l'apparence sans toucher à la logique.

### Note de compatibilité

`navigator.modelContext` est **déprécié depuis Chrome 150** : le getter a migré
vers `Document` dans le brouillon du 27 mai 2026. Le code cible
`document.modelContext` et retombe sur l'ancienne forme.

## Licence

MIT — voir [`LICENSE`](LICENSE).
