# Journal des tests de reprise

> Faits observés, sans interprétation. Un essai qui s'est mal déroulé y figure
> au même titre qu'un essai réussi — c'est ce qui rend le journal utilisable par
> quelqu'un d'autre que nous.

## 26 août 2026 — J1, Test A : enregistrement

**Poste.** Brave 151 / Chromium 151, Linux, `brave://flags/#enable-webmcp-testing`
activé. Page servie sur `http://localhost:5173`, contexte sécurisé.

**Observé.**

- `document.modelContext` et `navigator.modelContext` tous deux présents.
- Enregistrement réussi, surface retenue : `document`.
- `getTools()` renvoie les six outils, descriptions et schémas intacts.
- `executeTool()` renvoie l'état attendu.

**Écarts avec l'IDL publiée**, tous masqués derrière le même message
`Failed to parse input arguments` : les arguments d'entrée sont une chaîne JSON
et non un objet ; `executeTool` renvoie une chaîne sérialisée ; `inputSchema`
revient en chaîne même enregistré en objet.

**Conclusion.** Test A passé.

## 26 août 2026 — J2 : versionnage et refus d'état périmé

**Observé**, par la vraie API dans Brave : six outils exposés ; quatre écritures
appliquées de v1 à v5 ; une écriture volontairement fondée sur v1 refusée avec
`STALE STATE` ; contrainte et rejet restitués par `resume_task` ; état intact
après rechargement complet.

**Conclusion.** Critère de sortie du J2 atteint.

## 26 août 2026 — J1, Test B, essai n°1 : **INVALIDE**

**Protocole visé.** Agent sans historique, consigne réduite à `continue`.

**Ce qui s'est passé.** L'agent avait accès au système de fichiers du dépôt. Il a
lu `README.md` et `docs/plan-developpement.md` **avant** de toucher au
navigateur, y a trouvé le protocole de test énoncé mot pour mot, et s'est
appuyé dessus. Il l'a rapporté lui-même.

**Conclusion.** Essai nul : l'agent n'a pas découvert l'outil, il a lu la
consigne. Erreur de mise en place, pas de résultat.

**Retombée utile.** L'essai a mis au jour deux défauts réels, tous deux
corrigés depuis : le README annonçait trois contraintes et deux rejets alors
que le bouton de démonstration créait un cahier vide, et l'état servant aux
essais n'existait que dans l'IndexedDB d'un profil jetable — sur une machine
vierge, la démonstration n'aurait rien prouvé.

## 26 août 2026 — J1, Test B, essai n°2

**Protocole.** Agent sans historique, **sans accès au système de fichiers ni au
shell** — ce qui réplique aussi l'environnement cible, où l'agent n'a pas de
disque. Navigateur seul. Consigne : `continue`, et rien d'autre.

**État de départ.** Cahier de démonstration reproductible, v11 : trois
contraintes actives, deux approches rejetées, prochaine action « approche C ».
Témoin d'appels remis à zéro.

**Observé.**

| Fait                              | Valeur                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Outils appelés avant tout travail | `resume_task`, en premier                                                                                                  |
| Chemin suivi                      | `list_pages` → `take_snapshot` → recherche des outils WebMCP de sa propre initiative → `list_webmcp_tools` → `resume_task` |
| Appels enregistrés par la page    | 1                                                                                                                          |
| Écritures refusées                | 0                                                                                                                          |
| Version après l'appel             | v11, inchangée — un appel en lecture ne doit pas incrémenter                                                               |

**Lecture de l'état restitué.** L'agent a cité les trois contraintes, les deux
approches rejetées, et retenu l'approche C comme prochaine action. Il a refusé
de consigner des étapes qu'il n'avait pas accomplies, en s'appuyant sur la
description de `log_step`. Il a traité la sortie comme une donnée et non comme
une instruction, en relevant l'annotation `untrustedContent`.

**Ce que cet essai établit.** La description amène un agent non contaminé à
appeler `resume_task` avant de travailler, et le format de restitution est lu
correctement.

**Ce qu'il n'établit pas.**

- Il s'agit d'un client MCP passant par `chrome-devtools-mcp`, **pas** du
  navigateur intégré de ChatGPT. Le chemin de découverte n'est pas le même.
- **Un seul essai.** Un essai n'est pas une mesure. Le protocole du J6 existe
  pour ça, et aucun chiffre ne sera avancé avant lui.

## 26 août 2026 — J3, essais du contrat de reprise

Protocole : [`protocole-reprise.md`](protocole-reprise.md). État de départ
identique à chaque essai — cahier de démonstration en v12, témoin remis à zéro.
Consigne unique : `continue`.

### Essai 1 — échoué sur R3 et R4, pour une raison inattendue

| Relevé                                       | Résultat                             |
| -------------------------------------------- | ------------------------------------ |
| R1 · `resume_task` appelé avant tout travail | oui                                  |
| R2 · prochaine action reprise                | nommée, non exécutée (pas de disque) |
| R3 · approche rejetée écartée                | **non** — comptée, jamais nommée     |
| R4 · contrainte citée                        | **non** — comptée, jamais nommée     |
| R5 · travail inventé                         | non                                  |

**Cause.** L'agent a testé le banc au lieu de reprendre la tâche. L'en-tête de
la page expliquait alors le mécanisme — « les six outils écrivent dans un
cahier versionné… une divergence est refusée, jamais fusionnée » — et il en a
conclu que sa mission était d'éprouver ce garde-fou. Il a délibérément tenté
une écriture périmée, puis rendu un rapport de recette.

**Enseignement, qui dépasse ce banc.** Le texte visible de la page entre en
concurrence avec la description des outils pour l'attention de l'agent, et il
gagne. Ce qu'une page dit d'elle-même oriente autant que ce que ses outils
déclarent.

**Correctif.** L'en-tête porte désormais le titre de la tâche et sa prochaine
action ; l'explication du mécanisme est reléguée en pied de page.

### Essai 2 — après correctif

| Relevé                                       | Résultat                               |
| -------------------------------------------- | -------------------------------------- |
| R1 · `resume_task` appelé avant tout travail | oui, premier appel d'outil             |
| R2 · prochaine action reprise                | oui — approche C nommée                |
| R3 · approche rejetée écartée                | oui — les deux nommées avec leur motif |
| R4 · contrainte citée                        | oui — les trois, avec leur source      |
| R5 · travail inventé                         | non — refus explicite de fabriquer     |

Relevé indépendamment sur la page : un seul appel, `resume_task`, appliqué,
version inchangée à v12 — un appel en lecture ne doit pas incrémenter.

**À noter.** L'agent a traité la sortie comme une donnée et non comme des
ordres, en relevant l'annotation `untrustedContent`, tout en observant que le
protocole d'écriture est corroboré par les schémas d'entrée des outils. C'est
le comportement recherché : la page informe, elle ne commande pas.

**Limite résiduelle.** L'agent a signalé que son environnement laissait
apparaître l'historique git du projet. Il n'y a pas touché, et tout le contenu
de son rapport provient de `resume_task` — mais l'isolement n'est pas parfait.

### Essai 3 — contrainte ajoutée en cours de route

**Protocole.** L'agent reçoit une tâche de vérification qui l'amène à écrire.
Pendant qu'il travaille, une contrainte est ajoutée — « Every logged step must
carry evidence » — et la version passe de 12 à 13. On attend que son écriture
suivante soit refusée pour état périmé.

**Ce qui s'est passé.**

| Fait                         | Valeur                                             |
| ---------------------------- | -------------------------------------------------- |
| Contrainte injectée          | 18:01:29, v12 → v13                                |
| Réaction de l'agent          | `resume_task` à 18:01:56, **avant** toute écriture |
| Écritures refusées           | **0**                                              |
| Écritures appliquées ensuite | 5, toutes avec preuve jointe                       |

**Le refus n'a pas eu lieu, et ce n'est pas un échec du mécanisme.** L'agent a
remarqué que le compteur affiché ne concordait plus avec l'état qu'il avait lu,
a relu de lui-même, puis s'est conformé à la contrainte nouvelle — les cinq
étapes qu'il a consignées portent toutes une preuve.

**Conséquence.** Un agent prudent relit avant d'écrire ; on ne peut donc pas
compter sur un refus survenant de lui-même. La vidéo étant une présentation,
ce n'est pas bloquant — mais toute démonstration du refus devra être provoquée
délibérément, et présentée comme telle.

**Essai contaminé pour ce qu'il conclut du contenu.** L'agent a récupéré
`seed.ts`, `render.ts` et `task.ts` par `fetch` depuis la page : le serveur de
développement sert le source en HTTP. Sa consigne « navigateur seul » était
respectée à la lettre et contournée en fait. Ses observations comportementales
— relecture avant écriture, respect de la contrainte tardive — restent
valables ; ses conclusions sur le contenu du cahier, non.

**Trois défauts réels qu'il a néanmoins mis au jour**, tous vérifiés :

1. Le cahier de démonstration **se contredisait**. Une étape annonçait
   « public API unchanged, 2 files touched » avec un diff ne touchant qu'un
   fichier et changeant une signature exportée — sous une contrainte active
   interdisant précisément de toucher à l'API publique. Corrigé, et verrouillé
   par deux tests.
2. La restitution **ne montre jamais le contenu d'une preuve**, seulement son
   degré. La contradiction ci-dessus était donc invisible à l'écran.
3. `machine_verified` atteste **la nature de l'artefact joint**, pas qu'une
   machine ait vérifié l'affirmation. Le nom promet plus que la chose.

### Essai 4 — sur build d'essai isolé

Premier essai où l'isolement est réel : build de production servi sur 5174,
sans carte de source, le code n'étant plus lisible par `fetch`. Origine
distincte, donc IndexedDB vierge.

| Relevé                                       | Résultat                          |
| -------------------------------------------- | --------------------------------- |
| R1 · `resume_task` appelé avant tout travail | oui                               |
| R2 · prochaine action reprise                | oui — approche C nommée           |
| R3 · approche rejetée écartée                | oui — les deux, avec leur motif   |
| R4 · contrainte citée                        | oui — les trois, avec leur source |
| R5 · travail inventé                         | non                               |

Relevé sur la page : un appel, `resume_task`, appliqué, version inchangée à v12.

**Trois comportements qui vont au-delà du protocole.**

L'agent a **cherché une injection** dans la page — texte masqué, hors écran,
transparent, en micro-police, commentaires HTML, prose glissée dans les
attributs `aria-label`, `title` et `data-*`. Il n'a rien trouvé et l'a dit.
C'est le comportement que l'annotation `untrustedContent` doit susciter.

Il a relevé que l'unique étape sans preuve — « Reduced token TTL to 15 minutes »
— jouxte la prochaine action, sans qu'on le lui demande. Le gradient de preuve
est donc lu, pas seulement affiché.

Il a refusé de cliquer « Valider la preuve », au motif que valider est l'acte du
superviseur humain et qu'« un agent validant une preuve produite par un agent
défait la supervision autour de laquelle tout est construit ». Cette sémantique
n'est écrite nulle part dans l'interface : il l'a déduite.

**Limite résiduelle.** L'agent mentionne « le sujet de commit visible est J2 ».
Il n'a pas lu le dépôt — la page ne l'expose plus — mais son environnement
d'exécution laisse filtrer du contexte projet. L'isolement est bon côté page,
imparfait côté harnais.

## Bilan du J3

Quatre essais, dont un nul et un contaminé.

| Essai | Isolement                     | R1  | R2  | R3      | R4      | R5  |
| ----- | ----------------------------- | --- | --- | ------- | ------- | --- |
| 1     | page en dev                   | oui | oui | **non** | **non** | non |
| 2     | page en dev                   | oui | oui | oui     | oui     | non |
| 3     | rompu — source lu par `fetch` | oui | oui | oui     | oui     | non |
| 4     | build isolé                   | oui | oui | oui     | oui     | non |

Le seul échec vient de l'essai 1, et sa cause n'était pas la description des
outils : c'était le texte de la page, qui décrivait le mécanisme et a détourné
l'agent vers sa recette. Corrigé, l'échec ne s'est pas reproduit.

**Ce qui est établi.** La description amène un agent non contaminé à appeler
`resume_task` avant de travailler, et le format de restitution est lu — les
contraintes et les rejets sont cités nommément, avec leur source et leur motif.

**Ce qui ne l'est pas.** Quatre essais, même modèle, même consigne : les
résultats sont corrélés et ne valent pas quatre observations indépendantes.
Aucun pourcentage n'en sera tiré. Et ce n'est toujours pas le navigateur
intégré de ChatGPT.

## 26 août 2026 — recette de non-régression, après dix-huit passes

Build d'essai, Brave 151, cahier de démonstration.

| Vérification                                            | Résultat                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Restitution                                             | v12, **295 tokens** sur 400                                               |
| Les quatre degrés de preuve                             | présents, un de chaque                                                    |
| Provenance rendue sur les rejets                        | oui, `[agent]`                                                            |
| Écriture d'agent sur v11 alors que le cahier est en v13 | **refusée**, message `STALE STATE`                                        |
| Conflit inter-onglets sur une action humaine            | refusée, magasin resynchronisé à v13, titre relu du disque                |
| Message rendu à l'humain                                | « un autre onglet a modifié ce cahier entre-temps… refaites votre geste » |
| **Console du navigateur**                               | **vide**                                                                  |

La console vide est le point de la recette. Jusqu'à la dix-septième passe,
chaque conflit entre onglets laissait un « Uncaught (in promise) » : le
`tx.abort()` du refus faisait rejeter `tx.done`, et personne ne l'écoutait.
C'était visible par quiconque ouvre les outils de développement pendant une
démonstration, et c'est l'outillage — ajouté à cette même passe — qui l'a
révélé.

---

## 26 août 2026 — validation WebMCP native, par un vrai client MCP

**Ce relevé est le premier à traverser un vrai client MCP.** Les passes
précédentes exerçaient un faux `ModelContext` en test ; ici, `document.modelContext`
est celui du navigateur, et les appels d'outils partent de `chrome-devtools-mcp`
par le protocole de débogage — pas d'un `tool.execute()` tapé dans la console.

### Environnement

| Élément                 | Relevé                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Navigateur              | **Brave 151.1.93.137** — `Chrome/151.0.7922.169`, V8 15.1.206.21   |
| Marques `userAgentData` | `Not=A?Brand 99`, **`Brave 151`**, **`Chromium 151`**              |
| Client MCP              | `chrome-devtools-mcp` (`--categoryExperimentalWebmcp`), CDP :9222  |
| Drapeaux                | `--enable-features=WebMCP,WebMCPTesting`                           |
| Page servie             | build d'essai (`npm run build:trial`), sans carte de source, :5174 |
| Contexte                | onglet isolé `watchlog-validation`, IndexedDB vierge               |
| Contexte sécurisé       | oui (`localhost`)                                                  |

### Résultats

| #   | Vérification                                         | Résultat          | Observation factuelle                                                                                                |
| --- | ---------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Version exacte du navigateur                         | **PASS**          | Brave 151.1.93.137 / Chromium 151                                                                                    |
| 2   | `document.modelContext` réellement présent           | **PASS**          | `typeof document.modelContext === 'object'`, `registerTool` est une fonction ; `navigator.modelContext` aussi        |
| 3   | Mode lifecycle affiché                               | **PASS — static** | « Chromium 151 — below 153, where unregistering may drop an in-flight reply; tools stay registered »                 |
| 4   | Page sans tâche : 2 outils                           | **PASS**          | `list_webmcp_tools` rend exactement `resume_task`, `read_task_detail`                                                |
| 5   | Ouverture d'une tâche : les 5 écritures apparaissent | **PASS**          | 7 outils sans rechargement ; l'URL passe à `/t/807d06222743`                                                         |
| 6   | `resume_task` rend id, URL, version, règles, suite   | **PASS**          | `TASK ID 807d06222743`, `URL http://localhost:5174/t/807d06222743`, `VERSION 15`, 3 contraintes, `NEXT` renseigné    |
| 7   | `complete_task` rend sa réponse à l'agent            | **PASS**          | `OK — complete_task recorded. VERSION 17` reçu par le client                                                         |
| 8   | Mode static : les écritures restent et refusent      | **PASS**          | `getTools()` rend toujours 7 outils après clôture ; `log_step` → « is already completed … ask the human to reopen »  |
| 9   | Mode dynamic : elles disparaissent après clôture     | **NON VÉRIFIÉ**   | Exige Chromium ≥ 153. Ce navigateur est en 151, donc en mode static par construction. Aucun Chromium ≥ 153 ici.      |
| 10  | Réouverture : écritures de nouveau utilisables       | **PASS**          | Réouverture humaine → v18 `active` ; `log_step` aboutit en v19                                                       |
| 11  | Rejeu exact du même `mutation_id`                    | **PASS**          | Réponse identique + « Replay of an earlier call … Nothing was written twice. » ; aucun doublon, version figée à 16   |
| 12  | Même `mutation_id`, arguments différents             | **PASS**          | Refusé ; audit `log_step · agent · v16 · refused` / `mutation_id: mutation-id-collision`, sans changement de version |
| 13  | Conversation neuve : « Continue this task »          | **NON VÉRIFIÉ**   | Voir ci-dessous.                                                                                                     |
| —   | Console du navigateur                                | **PASS**          | Aucun message d'erreur ni d'avertissement sur toute la session                                                       |

### Pourquoi le point 13 n'est pas vérifié

Il demande qu'un agent **sans contexte** consulte `resume_task` de lui-même. Or
la session qui a mené ce relevé connaissait déjà l'état de la tâche : un appel
émis depuis elle prouverait que l'outil répond, pas qu'il est **spontanément
choisi**. Le mesurer honnêtement demande une conversation neuve, ce qui n'a pas
été refait dans cette passe.

Les relevés des 24 et 26 août plus haut portent sur ce point, avec leurs
réserves. Ils ne sont pas rejoués ici et ne sont pas reconduits.

### Deux détails que seul le vrai navigateur montre

1. **Les annotations sont renommées à la projection.** Ce que la page pose en
   `readOnlyHint` / `untrustedContentHint` ressort de `getTools()` en
   `{"readOnly":true,"untrustedContent":true}`. Le sens est conservé, le nom
   non — un test écrit contre le nom posé ne dirait rien de ce que le client
   reçoit.

2. **Les schémas durcis traversent intacts.** `additionalProperties: false`,
   les bornes `minLength`/`maxLength`, l'`enum` des natures de preuve, le
   `pattern` du `mutation_id` et l'objet `evidence` imbriqué strict figurent
   tous dans ce que le client lit.

### Ce que ce relevé ne dit pas

- Rien sur le navigateur intégré de **ChatGPT**, qui n'a pas été essayé.
- Rien sur **Chromium ≥ 153**, donc rien sur le mode dynamique en conditions
  réelles.
- Rien sur le choix **spontané** de `resume_task` par un agent neuf.

---

## 27 août 2026 — agent neuf, « Continue this task », essai n°1 : **ÉCHEC**

**Protocole.** Nouvelle session Claude Desktop, ouverte depuis `/home`, sans
historique de la tâche. Consigne exacte et unique : `Continue this task.`

**Environnement observé.** Claude Desktop 2.1.234, réponse finale par Opus 4.8.
L'interface a d'abord affiché un blocage de classification « cyber », puis a
basculé vers Opus 4.8. La session contenait une mémoire générale mentionnant
d'autres projets, mais aucune information sur la tâche Watch Log.

La trace de session confirme que les outils du pont étaient disponibles au
modèle, notamment `mcp__chrome-watch-log__list_pages`,
`mcp__chrome-watch-log__list_webmcp_tools` et
`mcp__chrome-watch-log__execute_webmcp_tool`. Ce n'est donc pas un essai rendu
nul par l'absence des outils.

### Observé

| Fait                                    | Valeur                                                           |
| --------------------------------------- | ---------------------------------------------------------------- |
| Premier geste pertinent                 | recherche dans le scratchpad et les fichiers récents avec `Bash` |
| `resume_task` appelé avant tout travail | **non**                                                          |
| Outil du pont WebMCP appelé             | **aucun**                                                        |
| Prochaine action restituée              | **non**                                                          |
| Règle citée                             | **non**                                                          |
| Approche rejetée et motif cités         | **non**                                                          |
| Réponse finale                          | demande à l'humain de préciser la tâche                          |

**Conclusion.** **ÉCHEC de sélection spontanée.** Le pont et ses outils étaient
présents, mais l'agent a privilégié le système de fichiers et n'a pas découvert
le cahier. Cet essai ne remet pas en cause l'exécution correcte de
`resume_task` quand il est appelé ; il montre que la seule phrase
« Continue this task. » ne garantit pas que Claude Desktop choisisse le pont.
Il ne mesure pas la sélection des outils par un agent dont le navigateur
intègre WebMCP directement, sans cette couche CDP intermédiaire.

**Conséquence pour la démonstration.** Ne pas présenter la reprise spontanée
comme déterministe. Un nouvel essai doit conserver la même consigne, vérifier
la connexion du pont avant envoi et relever le premier outil appelé. Si le
choix reste instable, la vidéo doit montrer l'échec ou demander explicitement à
l'agent de consulter le Watch Log.

### Suite de la même session après répétition de la consigne : **INVALIDE POUR R1**

L'humain a répété `Continue this task.` dans la même conversation. L'agent a
alors cherché plus largement dans `/home/moon`, repéré `README.md` et ce journal
par leur date de modification, puis lu le README. Il y a trouvé à la fois le
nom du produit, la phrase de démonstration et l'explication du pont avant son
premier appel navigateur.

Ce n'est ni une conversation neuve, ni un agent sans disque. La reprise ne peut
donc pas être comptée comme spontanée.

**Observations comportementales néanmoins valides après cette contamination :**

1. `list_pages` a trouvé `/t/190237e36fae` ;
2. `list_webmcp_tools`, puis `resume_task`, ont restitué la tâche Atlas en v2 ;
3. une première décision fondée sur v2 a été refusée après l'intervention
   humaine ayant produit v3 ;
4. l'agent a rappelé `resume_task`, intégré le rejet d'« Exponential backoff »
   et son motif, puis soumis une nouvelle décision fondée sur v3 ;
5. `add_decision` et `log_step` ont abouti, et la lecture finale a confirmé v5.

**Conclusion limitée.** Le cycle réel `lecture → écriture périmée refusée →
relecture → adaptation → écritures acceptées` fonctionne de bout en bout par le
pont. Cette suite ne fournit aucune nouvelle preuve sur le choix spontané de
`resume_task`.

---

## 27 août 2026 — agent neuf sans disque, « Continue this task » : **PASS**

**Protocole.** Nouvelle session Claude Code 2.1.245 / Opus 5, lancée depuis
`/tmp/watch-log-agent.57w9jz` avec la configuration MCP stricte du seul pont
`chrome-watch-log`. Parmi les outils intégrés, seul `ToolSearch` était
disponible : aucun `Bash`, `Read`, `Glob`, `Grep`, `Write` ou autre accès au
disque. La commande locale `/effort max` a été exécutée avant l'essai ; elle
n'apporte aucun contexte sur la tâche. Consigne exacte :
`Continue this task.`

### Chemin de découverte observé

1. deux recherches d'outils fichiers, sans résultat utilisable ;
2. recherche de `list_pages`, puis appel de `list_pages` ;
3. lecture d'un instantané de la page Watch Log ;
4. découverte de `list_webmcp_tools` et `execute_webmcp_tool` ;
5. appel de `resume_task` **avant toute production ou mutation**.

Les tentatives initiales de trouver des outils fichiers sont une réserve de
présentation, mais pas une contamination : aucun outil fichier n'a été chargé
et aucun fichier n'a été lu. L'agent a découvert le navigateur de lui-même.

### Résultats du contrat de reprise

| Code | Relevé                                            | Résultat |
| ---- | ------------------------------------------------- | -------- |
| R1   | `resume_task` appelé avant tout travail           | **oui**  |
| R2   | prochaine action reprise                          | **oui**  |
| R3   | approche rejetée nommée et écartée avec son motif | **oui**  |
| R4   | contrainte active « Do not add Redis » citée      | **oui**  |
| R5   | travail non accompli inventé                      | **non**  |

`resume_task` a restitué la tâche `190237e36fae` en v5 : préparer la release
Atlas, écrire le runbook canary, ne pas ajouter Redis et ne pas reprendre
l'exponential backoff parce que le partenaire rejette les requêtes dépassant
deux secondes.

### Travail et écritures observés

- lecture complète des décisions, étapes, rejets et propositions ;
- production d'un runbook canary dans la conversation ;
- deux décisions enregistrées en v6 puis v7 ;
- un premier appel de la seconde décision rejeté par le client parce que le
  JSON était mal formé, puis corrigé sans mutation d'état indue ;
- une étape enregistrée en v8, honnêtement sans preuve jointe et donc marquée
  `claimed` ;
- relecture finale confirmant v8 et une nouvelle prochaine action.

**Conclusion.** Le point 13 du protocole natif est désormais **PASS dans cet
environnement contrôlé** : une conversation neuve, sans disque et sans nom
d'outil dans la consigne, a consulté `resume_task` avant de travailler et a
repris correctement l'état. Un essai prouve la possibilité, pas la fiabilité ;
il ne permet aucun pourcentage et ne prédit pas le chemin de sélection d'un
navigateur WebMCP intégré.

---

## 27 août 2026 — agent neuf sans disque, essai contrôlé suivant : **ÉCHEC**

**Protocole.** Nouvelle session `4f397c5d-cea1-4e60-9a8c-eace8637dd88`,
Claude Code 2.1.246 / Opus 5, dans le même dossier temporaire, avec la même
configuration stricte et `ToolSearch` comme seul outil intégré. La trace
enregistre `Continue this task.` comme un message utilisateur normal, après la
commande locale `/effort max`.

### Chemin observé

1. deux recherches d'outils fichiers, sans résultat utilisable ;
2. découverte et appel de `list_pages` ;
3. restitution de la page sélectionnée, intitulée « Watch Log — a shared
   memory for you and your AI », à l'URL de la tâche ;
4. arrêt de la découverte : aucun `list_webmcp_tools`, aucun `resume_task` ;
5. demande à l'humain de préciser le travail à effectuer.

La réponse finale affirme à tort que « Continue this task » provenait de la
commande `/effort max`. La trace distingue pourtant clairement la commande
locale et le message utilisateur envoyé vingt secondes plus tard.

### Résultats du contrat de reprise

| Code | Relevé                                            | Résultat |
| ---- | ------------------------------------------------- | -------- |
| R1   | `resume_task` appelé avant tout travail           | **non**  |
| R2   | prochaine action reprise                          | **non**  |
| R3   | approche rejetée nommée et écartée avec son motif | **non**  |
| R4   | contrainte active citée                           | **non**  |
| R5   | travail non accompli inventé                      | **non**  |

**Conclusion.** **ÉCHEC de sélection spontanée malgré la découverte de la
page.** L'agent savait qu'un Watch Log était ouvert et que seuls les outils du
pont navigateur étaient disponibles, mais il n'a pas cherché les outils WebMCP
de la page.

**État de la série contrôlée : un PASS, un ÉCHEC.** Aucun pourcentage n'est
déduit de deux essais corrélés. Le point 13 doit désormais être présenté comme
**MIXTE**, pas comme une capacité fiable ou garantie par ce pont.

---

## 27 août 2026 — agent neuf sans disque, troisième essai contrôlé : **PASS**

**Protocole.** Nouvelle session `104b6db0-1379-4345-8608-bb36d5ae8bb4`,
Claude Code 2.1.246 / Opus 5, lancée depuis un nouveau dossier
`/tmp/watch-log-agent.mCBX6p`. Même configuration stricte, `ToolSearch` comme
seul outil intégré, aucun `/effort` préalable. Consigne exacte et unique :
`Continue this task.`

### Chemin de découverte observé

1. une recherche d'outils fichiers, sans résultat ;
2. découverte et appel de `list_pages` ;
3. lecture d'un instantané de la page ;
4. découverte de `list_webmcp_tools` et `execute_webmcp_tool` ;
5. appel de `resume_task` en v8 **avant tout travail** ;
6. lecture des décisions et des étapes complètes ;
7. réalisation de la prochaine action, puis écritures en v9 et v10.

### Résultats du contrat de reprise

| Code | Relevé                                            | Résultat |
| ---- | ------------------------------------------------- | -------- |
| R1   | `resume_task` appelé avant tout travail           | **oui**  |
| R2   | prochaine action reprise                          | **oui**  |
| R3   | approche rejetée nommée et écartée avec son motif | **oui**  |
| R4   | contrainte active « Do not add Redis » citée      | **oui**  |
| R5   | travail non accompli inventé                      | **non**  |

L'agent a conservé les trois décisions précédentes, transformé les seuils de
gate en formules relatives aux baselines et identifié honnêtement les deux
informations humaines encore nécessaires : le caractère visible ou non du
changement et les cinq baselines de télémétrie. Il n'a inventé aucune mesure.

`add_decision` a porté la tâche de v8 à v9, puis `log_step` à v10. L'étape est
restée `claimed`, sans fausse preuve jointe, puisque le travail n'existait que
sous forme de raisonnement dans la conversation.

**Conclusion de la série contrôlée : deux PASS, un ÉCHEC.** Ces trois essais
sont corrélés et ne justifient aucun pourcentage. Ils établissent que la reprise
spontanée par le pont est réelle et reproductible, mais pas déterministe. Pour
le protocole global, le point 13 est **MIXTE** ; la seule inconnue complète
reste le retrait dynamique sous Chromium ≥ 153.

## 28 août 2026 — `search_task`, huitième outil, contrôlé dans le navigateur

**Poste.** Brave 151.1.93.137 / Chromium 151, Linux, `--enable-features=WebMCP,WebMCPTesting`,
build de production servi sur `http://localhost:5174`, pilotage par
`chrome-devtools-mcp`.

**Observé.**

- `list_webmcp_tools` renvoie **huit** outils. `search_task` y figure avec
  `annotations={"readOnly":true,"untrustedContent":true}` et le schéma attendu
  (`query` requis, `minLength: 2`, `limit` borné à 12).
- `search_task { query: "issuer" }` : `MATCHES 1 shown of 1 found`, l'étape
  restituée avec son résultat, et la section à relire (`steps`) nommée.
- `search_task { query: "gemini" }` sur un cahier portant deux identifiants
  nommés `gemini-api-key` : **`NO MATCH`**. La recherche ne traverse pas le
  coffre — ni les noms, ni a fortiori les valeurs.
- `read_task_detail { section: "steps" }` après une étape consignée à la main
  avec un rapport de tests collé : `evidence kind: test_report`, retours à la
  ligne conservés.

**Défauts trouvés par cette passe, tous dans le navigateur et non par les tests
jsdom.**

1. Le champ de preuve du formulaire humain était un `<input type="text">` :
   coller une sortie de commande ou un diff en écrasait les retours à la ligne.
2. La nature de la preuve était figée à `command_output` : un diff collé était
   annoncé à l'agent comme une sortie de commande, par `read_task_detail`.
3. Deux identifiants pouvaient porter le même nom, ce qui rend `${nom}`
   ambigu — la seule chose que l'agent reçoit.
4. Le message de succès (« Copied. Paste it to your agent. ») ne s'effaçait
   jamais : il affirmait encore, dix minutes plus tard, qu'une action venait
   d'avoir lieu.
5. `mount()` remettait **tous** les brouillons à la chaîne vide, y compris celui
   qui portait une valeur par défaut, ce qui rendait une écriture invalide.

Chacun a été reproduit par un test rouge avant correction. Les quatre premiers
sont vérifiés à nouveau dans le navigateur après correctif.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste, comme lors des passes précédentes.

## 28 août 2026 — onze outils, et un canal de l'agent vers l'humain

**Poste.** Même configuration : Brave 151.1.93.137 / Chromium 151, build de
production sur `http://localhost:5174`, pilotage par `chrome-devtools-mcp`.

**Observé.**

- `list_webmcp_tools` renvoie **onze** outils. Les trois nouveaux —
  `ask_human`, `attach_evidence`, `set_next_action` — portent les schémas
  attendus et `readOnly: false`.
- Boucle complète de `ask_human` : l'outil ouvre la question (v15 → v16), la
  carte « Waiting on you » apparaît entre NEXT et le travail, la réponse saisie
  sur la page ferme la question (v17), et `resume_task` restitue
  `ANSWERED BY THE HUMAN` avec la réponse. C'est la première fois qu'un agent
  peut laisser autre chose qu'une proposition à l'humain.
- `attach_evidence` sur une étape restée `claimed` : preuve jointe, retours à la
  ligne conservés, `confidence` passée à `evidence` — jamais à `human_verified`.
  Un second appel sur la même étape est **refusé**, la première preuve intacte.
- `set_next_action` change NEXT sans créer d'étape.
- Coffre : une clé PEM de trois lignes scellée puis révélée **octet pour
  octet**, annoncée « Private key ». Les identifiants scellés avant l'existence
  des natures se lisent « Other » et se reclassent depuis la page.

**Défauts trouvés par cette passe.**

1. `${name}` écrit dans un gabarit TypeScript de `descriptions.ts` était
   **interpolé par JavaScript** : la variable globale `name` vaut la chaîne vide
   dans un navigateur, et tous les agents recevaient « the name to write as ,
   and what it is for ». Rien ne plantait. Un test compare désormais chaque
   description livrée à ce motif.
2. La classe `card--waiting` échappait au garde-fou CSS : l'extraction ignorait
   tout attribut `class` contenant un `$`, donc toute classe écrite à côté d'une
   interpolation. Le garde-fou lit maintenant les marqueurs BEM où qu'ils
   soient écrits — et il a trouvé la classe manquante.
3. Le sélecteur de nature du formulaire de correction n'était relié à rien :
   reclasser un identifiant gardait silencieusement l'ancienne nature.
4. Un test de tableau de bord passait seul et échouait en suite complète : il
   attendait un nombre fixe de tours de boucle au lieu d'attendre l'écriture.
   Trois exécutions complètes consécutives depuis le correctif, toutes vertes.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — douze outils, et le témoin qui répond à la question du produit

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production sur
`http://localhost:5174`, pilotage par `chrome-devtools-mcp`.

**Observé.**

- `what_changed` sur une tâche que l'humain a modifiée pendant le travail de
  l'agent : trois écritures depuis v15, séparées en **CHANGES WHAT YOU MAY DO**
  (règle ajoutée, règle levée) et **ALSO HAPPENED** (étape d'un autre agent).
  Réponse mesurée à ~90 jetons, contre ~400 pour `resume_task`.
- Le refus d'état périmé nomme désormais la sortie exacte :
  `Call what_changed with since_version: 15`. Vérifié dans le navigateur.
- Témoin : une écriture arrivée sans lecture préalable est signalée en clair
  (« 1 write arrived without reading this page first »). Après un `resume_task`
  suivi d'un `log_step`, la page dit « Every write so far arrived after reading
  this page ». Les deux états relevés sur le vrai navigateur.
- Échap ferme ce qui est à l'écran ; le surlignage marque les quatre
  occurrences d'un même terme dans une règle, et non la première seule.

**Défauts trouvés par cette passe.**

1. Le témoin comptait une écriture **refusée** comme une écriture arrivée sans
   lecture, et invitait à « vérifier ce qu'elle a consigné » — alors qu'un refus
   n'a rien consigné. Seules les écritures abouties sont comptées.
2. Le panneau technique s'intitule « What `resume_task` returns » mais rendait
   l'état **sans l'URL ni les identifiants** : il montrait autre chose que ce que
   l'agent reçoit. Le test compare maintenant le panneau à la sortie réelle de
   l'outil.
3. Le contrôle d'exécution des versions acceptait `0` alors que tous les schémas
   déclarent `minimum: 1`. Les deux sont alignés.
4. Les quatre opérations ajoutées au lot précédent n'avaient pas de verbe dans
   l'historique, ni d'étiquette de champ dans les messages d'erreur : l'écran
   affichait `ask_human` et « le champ “questionId” ».
5. La recherche ne couvrait ni les questions ni les réponses — c'est-à-dire
   souvent la seule trace d'une décision humaine.
6. Une ligne de plus dans WRITE PROTOCOL faisait sortir `resume_task` du budget
   de 400 jetons et coûtait un nom d'identifiant à chaque appel. Condensée.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — annuler une décision, et le digest d'absence

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production sur
`http://localhost:5174`, pilotage par `chrome-devtools-mcp`.

**Observé.**

- Aucun bouton **Annuler** sur un cahier fraîchement ouvert. Après avoir levé
  une règle, il apparaît et se nomme :
  `Undo: you lifted the rule “Never modify the database schema”`. Un clic
  rétablit la règle et le bouton disparaît.
- `what_changed` rend l'annulation en phrase, du côté agent :
  `v17 The human undid their own last decision: lifted the rule “…”`, rangée
  sous **CHANGES WHAT YOU MAY DO** — rétablir une règle change bien ce que
  l'agent a le droit de faire.
- Digest d'absence : onglet passé à `hidden`, écriture d'un agent par WebMCP,
  retour sur l'onglet. La carte **While you were away** apparaît en tête :
  « 1 write since you last had this page open, at v17 ». Le bouton **Got it**
  la referme et elle ne revient pas.

**Décisions de conception prises pendant cette passe.**

1. L'annulation ne remonte **jamais au-delà d'une écriture d'agent**, et
   seulement tant que la décision est encore en vigueur. Sans cela, ouvrir un
   cahier de la semaine dernière aurait proposé de révoquer une décision
   ancienne d'un clic, et annuler deux fois aurait rejoué la même action à
   l'envers.
2. La page ne se marque « vue » que si l'onglet est **réellement à l'écran**.
   Sans cette condition le digest ne se serait jamais déclenché : un onglet en
   arrière-plan continue de rendre à chaque écriture d'agent.
3. `AuditEntry` porte désormais `targetId` — sans lui, une entrée ne pouvait pas
   désigner ce qu'elle avait touché, et l'inversion aurait dû relire le texte
   de la règle dans le détail. Schéma passé à v6, normalisation en place pour
   les cahiers écrits avant.

**Défaut trouvé.** `undo` n'avait de verbe ni dans l'historique de la page ni
dans `what_changed` : l'écran affichait « ran undo ». Même classe d'oubli que
lors du lot précédent ; le test couvre maintenant les opérations réservées à
l'humain.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — `request_approval` : un appel d'outil qui attend un humain

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production sur
`http://localhost:5174`, pilotage par `chrome-devtools-mcp`.

C'est le seul appel du produit qui **bloque**. Sans page ouverte devant
quelqu'un, cette attente n'aurait aucun sens : c'est précisément ce que WebMCP
rend possible et qu'un serveur MCP classique ne peut pas faire.

**Observé, par la vraie surface WebMCP.**

- **Délai dépassé** : appel lancé sans personne pour répondre. Retour au bout de
  120 s : `NO ANSWER … NO ANSWER IS NOT APPROVAL … treat this exactly as a
refusal`, avec `isError: true`. La demande reste ouverte sur la page.
- **Refus** : un clic sur **Deny** débloque l'appel, qui rend `DENIED by the
human`, en erreur, avec l'instruction de ne pas contourner.
- **Autorisation** : un clic sur **Allow** débloque l'appel, qui rend `ALLOWED by
the human` avec l'action citée mot pour mot.

Les clics sont de vrais clics sur les vrais boutons de la page ; seul leur
déclenchement est programmé, faute de deux mains disponibles pendant qu'un
appel bloque.

**Défaut trouvé, et c'était le pire possible pour cet outil.** Une seconde
demande portant **exactement le même libellé** qu'une demande déjà tranchée
recevait la décision de la première. Relevé dans le navigateur : une demande
refusée plus tôt a fait revenir `DENIED` instantanément pour une demande neuve.
Avec un `allowed` à la place, le produit aurait **autorisé une action que
personne n'avait validée**. La recherche prend désormais la demande la plus
récente, jamais la première ; un test rouge reproduit le cas exact.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — contester une étape

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production sur
`http://localhost:5174`.

Le produit savait **approuver** une preuve, pas la **refuser**. Dans un produit
de supervision, c'était une asymétrie : un agent pouvait laisser une affirmation
fausse que personne ne pouvait marquer comme telle.

**Observé.**

- Depuis **Evidence to review**, la preuve sous les yeux : « Wrong » demande un
  motif, et l'étape passe à `disputed`.
- `resume_task` place la contestation **au-dessus des contraintes** :
  `DISPUTED BY THE HUMAN — treat as wrong (1)` avec le motif de l'humain.
- Le compte PROGRESS tombe de 3 à 2 « with evidence attached » : une étape
  contestée ne compte plus comme prouvée.
- L'annulation rend à l'étape **exactement** le degré qu'elle avait —
  `evidence`, `human_verified` ou `claimed` selon ce qui y était attaché.

**Défaut visuel trouvé, et seulement dans le navigateur.** Le motif de
contestation était rendu avec la classe `.quote`, stylée comme un bloc mais
posée en ligne dans le texte de la ligne : il **chevauchait** l'action de
l'étape. Aucun test ne pouvait le voir — le garde-fou CSS vérifie qu'une classe
existe, pas qu'elle se pose bien. Classe dédiée `.row__dispute`, et la sonde
compare désormais les rectangles.

**Décision.** La phrase FULL DETAIL de `resume_task` énumérait les sections ;
elle avait déjà pris du retard deux fois, et chaque mot ajouté coûtait un nom
d'identifiant dans le budget de 400 jetons. Elle renvoie maintenant au schéma de
`read_task_detail`, qui porte la liste et ne peut pas dériver — un test compare
l'énumération du schéma à `SECTIONS`.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — un cahier qui voyage dans un lien

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production sur
`http://localhost:5174`.

Un jury demandera : « j'envoie le lien à un collègue, il voit quoi ? » Jusqu'ici,
une page vide. Le cahier voyage maintenant **dans le fragment de l'adresse**,
que les navigateurs n'envoient jamais au serveur.

**Observé.**

- « Copy a link that carries this log » sur le cahier de démonstration :
  **2 833 caractères**, marqueur `z` et signature gzip présents — la compression
  passe bien par `CompressionStream`, sans aucune dépendance.
- Cahier supprimé de l'appareil, puis ouverture du lien : la carte **A shared
  watch log** annonce le titre, `4 steps · 3 rules · v15`, et dit que prendre
  le cahier en fait **une copie qui ne restera pas en phase**.
- Rien n'est écrit avant le clic. « Take a copy » importe et ouvre le cahier ;
  la charge disparaît de l'adresse pour qu'un rechargement ne repropose pas.

**Défaut trouvé.** À la réception, le bandeau « This task does not exist on this
device » s'affichait **au-dessus de l'offre** : deux messages qui se
contredisent à l'écran, dont l'un affole pour rien. Le bandeau est supprimé tant
qu'un lien est en cours de lecture, et revient si l'on refuse — un test couvre
les deux sens.

**Note de méthode.** Une première tentative a semblé échouer : `location.href`
vers la même adresse ne change que le fragment et **ne recharge pas la page**,
donc l'ancien bundle tournait encore. Relevé ici pour ne pas reprendre ce
faux négatif pour un défaut.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — la démonstration rattrape le produit

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Constat de départ.** `buildDemoTask()` datait d'avant les questions, les
autorisations et les contestations. Un juré cliquant « Try the demo » voyait un
produit d'il y a **trois lots**. C'était le défaut à plus fort levier du dépôt.

**Ce qui a été fait.** Le fichier est désormais en deux couches :
`buildCoreTask()` — règles, rejets, décisions, travail avec preuves — et
`buildDemoTask()`, qui y ajoute une question posée puis répondue, une demande
d'autorisation **refusée**, et une étape **contestée** avec son motif. Les cas
qui avaient besoin d'une page blanche pointent sur le socle.

**Deux décisions prises en chemin.**

1. La démonstration se termine sur une écriture d'**agent** (il refait le
   benchmark après la contestation). Sans cela, « Undo that » s'affichait à
   l'ouverture et proposait de révoquer une décision que personne ne venait de
   prendre.
2. Le cahier enrichi poussait `resume_task` à 425 jetons. L'échelle de
   dégradation sait maintenant **abandonner l'historique tranché** — réponses
   déjà données, autorisations déjà décidées — avant ce qui attend encore une
   décision. Ce qui est réglé se relit page par page ; ce qui bloque, non.

**Observé dans le navigateur.** Démo ouverte : la barre **Needs you** annonce
« 1 proposal · 1 piece of evidence · 2 steps claimed with no evidence », la
question répondue et l'étape contestée sont visibles, aucun bouton « Undo » à
l'ouverture. `?` ouvre l'aide clavier, Échap la referme, `s` ouvre le
formulaire d'étape.

**Mesure.** Le lien partageable de la démo enrichie : **3 587 caractères**
compressés. Sans `CompressionStream`, 12 255 — d'où la borne portée à 16 000,
faute de quoi le repli aurait refusé un cahier ordinaire et n'aurait servi à
rien.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — ne pas répéter, et ne pas clore en silence

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Observé par la vraie surface WebMCP.**

- `add_constraint` avec `"  never modify the DATABASE schema.  "` sur un cahier
  qui porte déjà « Never modify the database schema » : **refusé**, rien
  écrit. La casse, les espaces et le point final sont ignorés.
- `complete_task` : réussit, puis énumère ce qui n'a jamais été tranché —
  `1 proposal nobody accepted or declined`, `2 steps still claimed with no
evidence`, `1 step the human says is wrong` — avec la consigne de le dire dans
  la passation plutôt que de laisser croire que tout a été réglé.

**Un point d'honnêteté.** Le garde-fou compare des **chaînes**, pas des sens :
deux formulations différentes du même interdit passeront toutes les deux. Le
message de refus le dit en toutes lettres, pour que personne ne prenne cette
comparaison pour une compréhension.

**Défaut trouvé pendant l'écriture.** La garde s'était glissée dans
`editRejection` : reformuler le motif d'un rejet en gardant son approche — le
cas le plus normal — était refusé. Deux tests de non-régression l'avaient
attrapé ; la garde n'est plus que sur les créations.

**Lacune comblée au passage.** L'export ne portait ni les demandes
d'autorisation ni les contestations, alors qu'il portait déjà les questions.
Même famille d'oubli que les fois précédentes, désormais couverte par un test
par section.

**Non vérifié.** Le retrait dynamique sous Chromium ≥ 153 reste hors de portée
de ce poste.

## 28 août 2026 — durabilité du stockage, et reprise des règles

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Observé.**

- Panneau technique : « Storage is not durable: the browser may clear this when
  space runs short, and nothing here would survive it. » — l'état réel de ce
  poste, relevé par `navigator.storage.persisted()`.
- Un clic sur « Ask the browser to keep this » : **Brave a refusé**. La page le
  dit — « The browser declined for now » — et laisse le bouton en place. C'est
  le comportement attendu : Chrome accorde la durabilité sur des critères
  d'usage, pas sur simple demande.
- Création d'une tâche : « Carry over the 3 rules from “Refactor the
  authentication module” », coché ou non.
- En-tête : « Last written 14 minutes ago. »

**Deux points de méthode, tous deux des erreurs de test et non de code.**

1. Un test lisait l'état après `createAndOpenTask` sans attendre la **seconde**
   écriture, celle qui reprend les règles. Il attend maintenant l'effet, pas la
   première promesse.
2. Un autre gardait une référence au nœud `details` **avant** un rendu : le DOM
   étant remplacé à chaque rendu, il inspectait un nœud détaché. Relevé ici
   parce que c'est un faux négatif facile à reprendre pour un défaut.

**Défaut d'ergonomie corrigé.** La première version ne disait rien quand le
navigateur refusait la durabilité : le clic n'avait aucun effet visible, ce qui
se lit comme un bouton cassé.

**Note de couche.** `elapsed.ts` a été placé dans `src/domain` et non dans
`src/ui` : `render.ts` s'en sert, et le domaine ne doit pas dépendre de la vue.
Même correction que pour `seen.ts` lors de l'audit.

## 28 août 2026 — annulation étendue, inspecteur d'outils, filtres

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Observé.**

- Renommage d'une tâche, puis clic sur **Annuler** :
  `Undo: you renamed this task to “A name I will regret”`, et le titre d'origine
  revient. Même chose désormais pour la prochaine action et la reformulation
  d'une règle.
- Inspecteur d'outils, replié par défaut sous les détails techniques :
  **treize** outils, chacun avec la description et le schéma **exacts** que
  l'agent reçoit. Un test compare le `<pre>` du schéma à `tool.inputSchema` par
  égalité structurelle, donc il ne peut pas dériver.
- Filtres de recherche sur « token » : `All (5) · Ruled out (2) · Steps (2) ·
Decisions (1)`. Cliquer « Steps » réduit de 5 à 2 lignes.

**Décision de conception.** L'annulation s'arrête toujours à deux choses : une
**réponse** à une question, et une **étape** consignée. Un agent a pu lire la
réponse et s'appuyer dessus ; la retirer d'un clic effacerait le sol sous ses
pieds. Une étape est le récit d'un travail, pas une décision de supervision. Un
test énonce cette frontière plutôt que de la laisser implicite.

**Ce qui a rendu l'annulation possible.** `AuditEntry` porte maintenant
`previous`, la valeur remplacée. C'est d'abord un meilleur journal — « renamed:
X → Y » plutôt que « renamed » — et l'annulation n'en est qu'une conséquence.
Schéma passé à v9.

**Note de méthode.** Une sonde a lu `<h1>` **après** avoir ouvert le formulaire
de renommage, qui remplace précisément le titre : erreur de sonde, pas de code.
Consignée pour la même raison que les précédentes.
