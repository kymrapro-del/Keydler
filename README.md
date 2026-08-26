# Cahier de quart

**Une mémoire de tâche persistante et supervisée, que les agents lisent et
écrivent par WebMCP.**

Quand un agent perd son contexte, il ne perd pas seulement des informations : il
perd les **interdits**. Il repropose l'approche déjà écartée, réintroduit la
dépendance qu'on lui avait refusée, et refait le travail dont il ne sait plus
qu'il l'a fait. Un résumé de conversation garde les faits saillants et sacrifie
précisément ce qui contraint.

Le cahier de quart sort cette contrainte de la conversation et la met dans une
page web : contraintes en vigueur, travail accompli avec ses preuves, approches
condamnées avec leur motif, prochaine action. L'agent y revient par un outil
permanent. L'humain la corrige en direct, sans interrompre l'agent.

---

## Ce que la mesure donne

Huit tâches, deux conditions, une seule question binaire : **après une perte de
contexte, l'approche explicitement condamnée est-elle reproposée ?**

> **Sans cahier : 8 fois sur 8. Avec cahier : 0 fois sur 8.**

Le protocole est dans [`docs/protocole-mesure.md`](docs/protocole-mesure.md),
les huit tâches dans [`docs/mesures/taches.md`](docs/mesures/taches.md), et les
relevés avec leurs réserves dans
[`docs/mesures/resultats.md`](docs/mesures/resultats.md).

**Ce que ce chiffre ne dit pas**, et qui compte autant :

- Huit essais par condition, même modèle, même consigne. Les résultats sont
  **corrélés** : ce ne sont pas seize observations indépendantes, et aucun
  pourcentage n'en sera tiré.
- **Le témoin ne montre pas de l'incompétence.** Ses huit réponses sont bonnes
  et argumentées — cookie `HttpOnly`, pagination par curseur, seau à jetons
  Redis, `COPY`, repli exponentiel, entiers en unités mineures, index unique,
  vol unique. Ce sont les réponses de manuel. Elles sont fausses **ici**, et
  seulement ici, pour une raison locale qu'aucun modèle ne peut deviner.

C'est d'ailleurs le principe de conception des tâches, trouvé en se trompant :
une première version condamnait des anti-patrons classiques, et le témoin est
resté à zéro — un agent capable les évite seul. **Ce qu'il faut condamner, ce
n'est pas la mauvaise réponse : c'est la bonne réponse, écartée pour une raison
locale.**

### Ce que le chiffre cache, et qui vaut mieux que lui

Aucun agent n'a évité l'approche condamnée en fuyant un mot-clé. Tous ont lu
**le motif** et en ont tiré la part encore valable :

- « ce qui a été rejeté, c'est l'adossement à Redis, pas l'algorithme du seau »
  → il retient un seau, en mémoire ;
- « l'échelle était fixée sur l'unité mineure, pas l'usage d'entiers »
  → il retient des entiers, à l'échelle 8 ;
- « le défaut était l'attente, pas la déduplication »
  → il garde la déduplication, sans blocage.

C'est la justification directe d'un choix : **le domaine refuse un rejet sans
motif**. Sans le motif, ces agents auraient évité un mot et perdu l'idée.

---

## Comment ça marche

### Un pointeur permanent

Un seul outil compte vraiment : `resume_task`. Sa description ne dit pas ce
qu'il fait, elle dit **quand l'appeler** — au début d'une conversation neuve,
après une perte de contexte, et chaque fois qu'une écriture est refusée. Un
agent n'appelle un outil que s'il comprend qu'il en a besoin maintenant.

Il rend un texte compact, sous 400 tokens, une information par ligne :

```
TASK        Refactor the authentication module
VERSION     12
STATUS      active
PROGRESS    4 steps logged · 3 backed by evidence
NEXT        Implement approach C — session-bound refresh tokens

CONSTRAINTS (3 active)
  [human] Never modify the database schema
  [human] Do not add any new dependency
  [agent] Keep the public API unchanged

REJECTED — do not retry
  [human] JWT approach B — breaks refresh token rotation under concurrent logins
  [agent] Partial index on sessions — benchmarked 3x slower than the full index

RECENT WORK
  [human]    Ran the authentication test suite — 183 passed, 0 failed
  [machine]  Benchmarked the prototype — p95 unchanged, no schema change
  [evidence] Extracted the token issuer behind an interface — API unchanged
  [claimed]  Reduced token TTL to 15 minutes — applied, not yet measured

WRITE PROTOCOL
  Every write must carry based_on_version: 12
  A refused write means the human changed this state. Call resume_task again.
```

La **provenance** figure partout, contraintes comme rejets. Sans elle, un veto
humain et une conjecture d'agent se liraient à l'identique — et un agent qui
condamne à tort la bonne approche empoisonnerait invisiblement toutes les
conversations suivantes.

### Un refus d'écriture périmée

Chaque écriture d'agent porte le `based_on_version` sur lequel il croit
travailler. Si l'humain a modifié l'état entre-temps, l'écriture est **refusée**
— jamais fusionnée :

```
STALE STATE
You are attempting to log work based on task state v11.
Current state is v12. Call resume_task before continuing.
```

C'est le seul endroit du système où une contrainte est réellement imposée. Et
c'est ce qui permet à l'humain d'intervenir pendant que l'agent travaille : sa
contrainte périme la version, l'écriture suivante tombe, l'agent rappelle le
pointeur et découvre la nouvelle règle.

La garantie vit dans le **stockage**, pas dans la page : la comparaison de
version se fait à l'intérieur de la transaction IndexedDB. Sans cela, deux
onglets ouverts sur le même cahier se seraient écrasés en silence.

### Une asymétrie assumée

Une écriture **humaine** ne porte pas de version et n'est jamais refusée. Une
écriture **d'agent** en porte toujours une et peut l'être. Toute la supervision
tient dans cette asymétrie.

### La preuve, distincte de l'affirmation

Le degré n'est jamais déclaré : il est **déduit** de ce que l'écriture apporte.
Aucune auto-attribution n'est possible.

| Degré | D'où il vient |
|---|---|
| `machine_verified` | La preuve jointe est une sortie de machine — rapport de test, sortie de commande |
| `human_verified` | Un humain a cliqué. **Seul chemin.** Aucun agent ne peut l'atteindre |
| `evidence` | Une preuve est jointe : lien, diff, empreinte. Elle atteste d'un changement, pas d'une vérification |
| `claimed` | Rien de joint |

---

## Les six outils

Six primitives, aucune de plus : chaque outil supplémentaire dilue la lisibilité
de l'ensemble pour l'agent, qui choisit d'autant moins bien qu'il a plus à lire.

| Outil | Entrées | Rôle |
|---|---|---|
| `resume_task` | — | Restitue l'état canonique et la version |
| `log_step` | `action, result, evidence?, next?, based_on_version` | Consigne une étape et son degré de preuve |
| `add_constraint` | `rule, based_on_version` | Consigne permanente, côté agent |
| `reject_approach` | `approach, reason, based_on_version` | Empêche de réessayer ce qui a échoué |
| `add_decision` | `choice, rationale, based_on_version` | Le pourquoi, que tout résumé perd |
| `complete_task` | `summary, based_on_version` | Instantané final, transmissible |

## La supervision humaine

Depuis la page, pendant que l'agent travaille :

- **ajouter une contrainte**, marquée `[human]`, qui périme la version sur
  laquelle l'agent croit travailler ;
- **lever ou rétablir** une règle — une règle levée disparaît de ce que l'agent
  relit ;
- **condamner une approche**, motif obligatoire ;
- **valider une preuve d'un clic**, seul chemin vers `human_verified` ;
- **rouvrir une tâche close** — sans quoi une clôture décidée par l'agent serait
  irréversible et le rapport de force s'inverserait ;
- **exporter le cahier**, avec le contenu intégral des preuves et le journal des
  écritures, refus compris.

La saisie en cours **survit aux écritures de l'agent** : texte, curseur et focus
sont reportés à travers le redessin. Sans cela, l'agent effacerait la contrainte
que l'humain est en train de taper contre lui — soit exactement le moment que ce
produit existe pour rendre possible.

---

## Essayer

```bash
npm install && npm run dev
```

La page s'ouvre sur `http://localhost:5173`. Elle fonctionne sans WebMCP :
l'état est réel et persistant, seule la connexion aux agents manque.

### Activer WebMCP

En essai d'origine depuis Chrome 149. En local, aucun jeton n'est nécessaire :

1. ouvrir `chrome://flags/#enable-webmcp-testing` ;
2. passer le drapeau à **Enabled** ;
3. relancer le navigateur et recharger la page.

**Brave fonctionne.** Vérifié sur Brave 151 / Chromium 151 sous Linux : le
drapeau existe et les deux surfaces sont exposées. Inutile d'installer Chrome.

Pour une origine déployée, poser le jeton dans `.env` — il est injecté par
script au démarrage, ce qui évite de committer dans `index.html` un jeton lié à
une seule origine :

```
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=votre-jeton
```

### Faire reprendre un agent

ChatGPT desktop n'existe pas sous Linux, et n'est pas nécessaire : les règles du
concours demandent une URL accessible par le navigateur intégré de ChatGPT **ou**
Chrome avec WebMCP activé. Un pont MCP expose les outils de la page à n'importe
quel client MCP.

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Le navigateur doit exposer le protocole de débogage. Deux points non évidents :
le basculement dans `brave://inspect/#remote-debugging` **n'ouvre aucun port**,
et Chromium ≥ 136 **refuse** le débogage distant sur le profil par défaut.

```bash
brave --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-webmcp \
  --enable-features=WebMCP,WebMCPTesting \
  http://localhost:5173
```

La fonctionnalité s'appelle **`WebMCPTesting`** dans Brave 151, alors que l'aide
de `chrome-devtools-mcp` annonce `WebMCP`. Passer les deux.

Ensuite : conversation neuve, onglet ouvert, et écrire `continue`.

### Rejouer la mesure

```bash
npm run trial      # build sans carte de source, servi sur 5174
```

Puis ouvrir `http://localhost:5174/?mesure=1` … `?mesure=8`. Chaque adresse
reconstruit exactement le cahier sur lequel la mesure a été faite.

Le build d'essai est **obligatoire** pour un essai valable : le serveur de
développement sert tout le source en HTTP, et un agent « navigateur seul » lit
alors l'intégralité du projet par `fetch`. Cela s'est produit, et l'essai
concerné est marqué nul dans le journal.

**Exporter avant de réinitialiser.** Vider IndexedDB entre deux essais détruit
la pièce en même temps qu'elle assainit l'essai — c'est arrivé, et sept cahiers
ont été perdus.

---

## Architecture

L'enregistrement des outils vit **hors du cycle de rendu** — dans un module
importé au démarrage, jamais dans un `useEffect`. Un agent peut appeler
`resume_task` alors qu'aucun composant n'est monté.

```
agent ──WebMCP──▶  webmcp/  ──▶  store/  ──▶  persistence/  ──▶  IndexedDB
                                    ▲
humain ──clics──────────────────────┴──▶  interface (même magasin)
```

| Dossier | Rôle |
|---|---|
| `src/domain` | Types, invariants, mutations pures. Aucune dépendance : ni DOM, ni IndexedDB, ni WebMCP |
| `src/persistence` | IndexedDB, migrations, lecture défensive |
| `src/store` | Source de vérité observable, écritures sérialisées |
| `src/webmcp` | Adaptateur d'API, descriptions, six outils, enregistrement singleton |
| `src/export` | Export d'un cahier, preuves et journal compris |
| `src/demo` | Cahier de démonstration et huit cahiers de mesure, reproductibles |
| `src/tokens.css` | Jetons visuels neutres — le seul fichier que le design réécrit |

**Aucune valeur visuelle en dur hors de `src/tokens.css`.** Réécrire ce fichier
suffit à changer l'apparence sans toucher à la logique.

### Note de compatibilité

`navigator.modelContext` est **déprécié depuis Chrome 150** : le getter a migré
vers `Document` dans le brouillon du 27 mai 2026. Le code cible
`document.modelContext` et retombe sur l'ancienne forme. Toute cette instabilité
est enfermée dans `src/webmcp/adapter.ts`.

L'implémentation de Chromium 151 diverge par ailleurs de l'IDL publiée, et les
trois écarts se manifestent par le même message peu bavard :

```js
await document.modelContext.executeTool(tool, '{}')   // ✅ chaîne JSON
await document.modelContext.executeTool(tool, {})     // ❌ Failed to parse input arguments
```

Les arguments d'entrée sont une chaîne JSON, `executeTool` renvoie une chaîne
sérialisée, et `inputSchema` fait l'aller-retour en chaîne.

---

## Vérifier

```bash
npm run check
```

Types, 97 tests d'invariants, build de production. Les tests couvrent le
versionnage, le refus d'état périmé, les écritures concurrentes, le conflit
entre onglets, la lecture défensive du stockage, la traçabilité des refus, le
budget de restitution, le cycle de vie, l'export, et la forme des cahiers de
mesure.

## Vie privée

Aucun compte, aucun serveur, aucune donnée qui quitte l'appareil. Tout est dans
IndexedDB. Si le stockage est indisponible — navigation privée, données de site
bloquées — l'agent reçoit `STORAGE UNAVAILABLE` avec l'instruction explicite de
ne pas conclure à l'absence de tâche.

## Journal de bord

Les essais de reprise, y compris ceux qui ont échoué ou tourné court, sont
consignés dans [`docs/journal-tests.md`](docs/journal-tests.md). Le plan de
développement et la répartition des voies sont dans
[`docs/plan-developpement.md`](docs/plan-developpement.md).

## Licence

MIT — voir [`LICENSE`](LICENSE).
