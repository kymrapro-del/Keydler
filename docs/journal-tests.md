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
d'autres projets, mais aucune information sur la tâche en cours.

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
l'agent de consulter la page.

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
3. lecture d'un instantané de la page ;
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
   memory for you and your AI » — le produit portait encore ce nom à la date
   de ce relevé —, à l'URL de la tâche ;
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
page.** L'agent savait qu'une page de cahier était ouverte et que seuls les outils du
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
  log** annonce le titre, `4 steps · 3 rules · v15`, et dit que prendre
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

## 28 août 2026 — la définition de « terminé », et les agents sans WebMCP

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Deux manques de fond, pas de surface.**

1. Le cahier disait la **prochaine action** et jamais **ce que « terminé » veut
   dire**. Une conversation qui reprend connaissait le pas suivant, pas la
   destination. `DONE WHEN` est désormais à côté de `NEXT` dans ce que lit tout
   agent, et `complete_task` le lui rappelle pour que le résumé de clôture dise
   s'il a été atteint.
2. Un agent **sans WebMCP** — l'immense majorité aujourd'hui — ne pouvait rien
   lire de ce cahier. « Copy the log as text » copie la sortie **exacte** de
   `resume_task`, encadrée d'une consigne. Un test compare le texte copié au
   rendu de `renderTaskState` avec les mêmes options : ce n'est pas une variante
   écrite pour l'écran.

**Choix de modèle.** Le but est **humain seulement**. Un agent peut le demander
par `ask_human`, pas l'écrire : la définition du succès est précisément la chose
que l'humain doit tenir.

**Défaut de mise en forme, trouvé dans le navigateur.** `DONE WHEN` s'était posé
après le bloc des contestations, sans ligne vide : il se lisait comme une partie
de ce bloc. Remonté dans l'en-tête, avec `NEXT`.

**Effet de bord repéré et traité.** Rendre `optionalText` tolérant aux espaces —
pour qu'un champ vidé à la main veuille dire « rien » — a rendu
`set_next_action` capable d'**effacer** la prochaine action avec une chaîne
d'espaces, alors que son schéma déclare `minLength: 1`. Un test existant l'a
attrapé. L'outil valide maintenant strictement ; l'humain garde le droit de
vider le champ.

## 28 août 2026 — vue d'ensemble, et un appel d'outil qui se voit

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

**Deux questions qu'on ne pouvait pas poser au produit.**

1. « Laquelle de mes tâches est bloquée ? » demandait d'ouvrir chacune. Le
   sélecteur porte désormais, par tâche, un résumé de ce qui attend — relevé
   dans le navigateur : `1 proposal to accept or decline +3 more`. Le résumé
   nomme ce qui coûte le plus de rater et compte le reste ; une énumération
   complète dans une pastille ne se lit pas.
2. « Un agent travaille-t-il en ce moment ? » Après un appel réel de
   `search_task`, l'en-tête affiche : `An agent called search_task just now.`
   Le libellé rapporte **un appel observé**, jamais une présence : rien dans
   WebMCP ne dit à une page qu'un agent est là, et un test interdit le mot
   « connected ».

**Un test qui passait pour la mauvaise raison.** Le premier jet vérifiait qu'une
ligne du sélecteur contenait « blocked » — sur une tâche intitulée « Blocked
task ». C'était le titre qui satisfaisait l'assertion, pas la pastille. Tâche
renommée, assertion portée sur l'élément.

**Un test intermittent, traqué plutôt que toléré.** « condamne une approche,
marquée humaine » échouait en suite complète environ une fois sur deux : il
attendait un nombre fixe de tours de boucle au lieu de l'écriture. Quatre autres
endroits du même fichier avaient le même motif ; trois attendent un **refus**,
où il n'y a rien à attendre, et sont restés tels quels. Cinq exécutions
complètes consécutives vertes depuis.

## 28 août 2026 — l'histoire d'une seule règle

**Poste.** Brave 151.1.93.137 / Chromium 151, build de production.

Le journal contenait déjà tout ce qui était arrivé à chaque règle — `targetId`
avait été ajouté pour rendre l'annulation possible — mais aucune surface ne
posait la question « qu'est-il arrivé à celle-ci ? ». Chaque règle porte
désormais un bouton **History**.

**Observé.** Une règle levée depuis l'écran, puis son histoire dépliée :
`28/08/2026, 15:11:39 — You lifted a rule — Never modify the database schema`.
Aucun nom d'opération machine, une seule histoire ouverte à la fois, aucun
débordement horizontal.

**Erreur de test, consignée.** Le montage appelait `buildCoreTask()` **deux
fois** — une pour lire l'identifiant de la règle, une pour la tâche — donc
l'identifiant ne correspondait à rien. Le domaine refusait correctement avec
« no constraint with id … » ; c'est la sonde qui était fausse.

## 28 août 2026 — échelle et coût

**Poste.** Chrome, serveur de développement, cahier de 40 règles et
30 approches écartées écrit directement dans IndexedDB.

Le rapport complet est dans [échelle](echelle-2026-08-28.md). Ce qui a été vu
dans le navigateur, et non seulement en jsdom :

**Observé.** 12 lignes de règles sur 40, « 28 rules still in force are not
shown », « Show all 40 rules » ; 12 approches écartées sur 30. Après clic :
40 lignes, avertissement disparu, bouton devenu « Show fewer », **focus resté
sur le bouton**. 360 nœuds repliés, 499 dépliés. Styles calculés réels sur
l'avertissement comme sur le bouton.

**Pas de capture d'écran.** Le panneau de capture de cet environnement a rendu
des images vides alors que le DOM répondait. Noté plutôt que remplacé par une
image qui ne montre rien.

**Anomalie non reproduite.** Au premier essai, la page est restée sur
« Loading… » après écriture directe dans IndexedDB ; après vidage et réécriture
du même cahier, chargement normal. Une connexion IndexedDB tenue ouverte ne
reproduit pas le blocage. Consigné comme non expliqué.

**Sélecteur de cahiers, vérifié aussi.** 41 cahiers sur le poste, 12 lignes
affichées, « Show all 40 tasks », 457 nœuds ; après clic, 40 lignes et
681 nœuds. C'est la dimension que le test de garde manquait : il faisait varier
le contenu d'un cahier, jamais le nombre de cahiers.

**Erreurs de sonde, consignées.** Deux fois : `.rows li` compté sur toute la
page alors que la carte visée était « Rules to follow », et une référence DOM
relue après un rendu qui l'avait remplacée. Dans les deux cas c'est la sonde qui
était fausse, pas le produit.

## 28 août 2026 — second tour d'échelle, en navigateur

**Poste.** Chrome, serveur de développement, cahier de 2000 étapes (798 ko en
base) avec preuves attachées.

**Migration de base observée sur place.** La base est passée de la version 2 à
la 3 sans être vidée : `db.version === 3`, les deux index présents
(`by-id-version`, `by-updatedAt`), et le cahier de 2000 étapes intact. C'est le
point qui compte : une migration ratée perdrait les données de vraies personnes.

**L'index répond juste.** `getKey(['perf01', 2100])` rend `'perf01'` ;
`getKey(['perf01', 9999])` ne rend rien. 0,1 ms contre 2,3 ms pour la relecture
complète qu'il remplace.

**Écriture réelle depuis l'écran.** Une règle ajoutée par le formulaire, écrite
et affichée en 20,5 ms de bout en bout.

**Repli de démarrage.** `lastTaskId` effacé de la base, rechargement : la page a
retrouvé « Shard migration » seule.

**Frappe dans la recherche.** 6,9 ms de médiane, image comprise, sur ce même
cahier — sous la barre d'une image à 60 Hz.

**Une décision prise sur la mesure, contre l'intuition.** Réécrire les 58 ko de
HTML de la page coûte **0,7 ms** dans Chrome, contre 15 ms sous jsdom. Le rendu
par sections, qui semblait s'imposer d'après les chiffres jsdom, aurait donc
gagné moins d'une milliseconde pour une refonte du tableau de bord entier. Non
fait.

## 28 août 2026 — ce qui voyage avec un lien

**Poste.** Chrome, serveur de développement, cahier portant trois preuves dont
une sortie de commande contenant un faux jeton et un nom d'hôte interne.

Le lien partageable et l'export emportent les preuves telles qu'elles ont été
collées. Le README le disait ; l'écran, non — et c'est l'écran qu'on lit avant
de cliquer. Pire, l'ancien message n'arrivait qu'**après** la copie, quand la
décision était déjà prise.

**Observé.** Sur ce cahier, sous le bouton de partage : « 3 pieces of evidence
travel with it, pasted exactly as they were. Command output often holds a token
or an internal hostname — read what it carries before you send this on. Sealed
credentials never travel. » Bloc de 820 × 50 px, gris `rgb(160, 160, 172)`,
aucun débordement horizontal. Les deux champs de preuve portent « Kept exactly
as pasted, and it travels with every export and shared link. », positionnée sous
le textarea. Le panneau technique porte la note d'export.

**Ce qui a été refusé.** Un avertissement affiché en permanence. Il ne paraît
que s'il y a réellement une preuve attachée, et il compte : un avertissement
montré sans raison s'apprend à ne plus être lu. Un test tient ce silence.

**Une régression évitée de justesse.** La première rédaction du message de
copie perdait le mot « copy », et avec lui l'idée que le destinataire reçoit un
exemplaire à lui, qui divergera. Un test existant l'a rattrapée — il ne
vérifiait pas une chaîne, il vérifiait cette idée.

## 28 août 2026 — les budgets de caractères de Chrome

Chrome publie des budgets pour les outils WebMCP : 30 caractères par nom, 500
par description d'outil, 150 par description de paramètre, 1,5 k par sortie —
des recommandations, pas des limites dures, mais au-delà on « tombe sur les
garde-fous des agents ».

**Mesuré avant.** Dix descriptions sur treize dépassaient, jusqu'à 801. Une
description de paramètre — `mutation_id`, 351 caractères — dépassait de plus du
double, et elle était répétée sur les neuf outils d'écriture. Le catalogue
entier, ce qu'un agent lit à chaque énumération, pesait 20 378 caractères.

**Après :** 15 576, soit 24 % de moins, et aucune borne dépassée.

**La règle éditoriale.** Une description d'outil instruit, le README explique.
Ce qui a été coupé, ce sont les justifications — pourquoi la règle existe — et
les rappels de protocole qui figuraient déjà trois fois : dans le schéma, dans
le bloc WRITE PROTOCOL de `resume_task`, et dans le texte des refus. Aucune
instruction n'a été retirée, et un second bloc d'épreuves nomme celles qui
devaient survivre : « BEFORE doing any work », « Do NOT guess and carry on »,
« NO ANSWER IS NOT APPROVAL », « does not prove the work was never attempted ».

**Un changement essayé puis retiré.** Descendre `TOKEN_BUDGET` de 400 à 375
pour tomber pile sur les 1,5 k de Chrome. Mesuré : dix-sept caractères gagnés
sur une restitution ordinaire, et un nom d'identifiant perdu à l'écran sur un
cahier chargé. Mauvais échange, annulé. Les restitutions réelles mesurent 1501
et 1484 caractères — la recommandation est tenue à un caractère près sans
l'avoir visée, et l'écart de 6,7 % entre le budget du produit et celui de Chrome
est écrit dans le test plutôt que maquillé.

**Trois tests existants ont refusé la coupe, à raison.** Ils tenaient le contrat
de rejeu, le fait qu'une preuve jointe n'est pas vérifiée, et le déclencheur de
`resume_task`. Deux d'entre eux ont échoué non parce que le sens avait disparu,
mais parce que la phrase enjambait un retour à la ligne du gabarit : les
nouvelles épreuves comparent donc sur un texte à espaces normalisés, comme le
lit un agent.

**Vérifié en navigateur, finalement.** J'avais écrit ne pas pouvoir le faire :
le panneau de cette session n'expose pas `document.modelContext`, et pour cause
— il tourne sur Chromium 148 (Electron), alors que WebMCP demande 149 et plus.
Brave 151 est installé sur le poste, et le README documente la commande.
Lancé sur un profil jetable avec `--enable-features=WebMCP,WebMCPTesting`,
`document.modelContext` est bien un objet et les treize outils s'enregistrent
dès qu'une tâche est ouverte — quatre seulement avant, ce qui est le
comportement attendu : les outils suivent l'état.

Relevé tel qu'un agent le reçoit, par `getTools()` :

| Budget                        | Recommandé | Mesuré |
| ----------------------------- | ---------- | ------ |
| Nom d'outil                   | 30         | 16     |
| Description d'outil           | 500        | 499    |
| Description de paramètre (46) | 150        | 146    |

Aucun dépassement. Les quatre outils de lecture portent bien
`untrustedContentHint`.

**Et une erreur dans ma propre garde, trouvée par cette vérification.** J'avais
mesuré la sortie de `resume_task` par `renderTaskState(task)` sans options, soit
1484 caractères. Appelé pour de vrai par `execute_webmcp_tool`, il en rend
**1528** : l'outil passe toujours l'adresse de la tâche, que ma mesure omettait.
Le test se rassurait donc sur autre chose que ce qui part. Corrigé — il mesure
maintenant avec l'adresse.

La position réelle est donc : 1528 caractères, soit **1,9 % au-dessus** de la
recommandation de Chrome et à l'intérieur du budget du produit (400 tokens,
1600 caractères). Écrit plutôt que rattrapé en rognant de la prose pour tomber
sur un chiffre rond — c'est le même arbitrage que le `TOKEN_BUDGET` à 375, et
il se tranche pareil.

## 28 août 2026 — passe de vérification en WebMCP réel

**Poste.** Brave 151.1.93.137 / Chromium 151, profil jetable,
`--enable-features=WebMCP,WebMCPTesting`, serveur de développement. Les appels
d'outil passent par `execute_webmcp_tool`, donc par la même surface qu'un agent.
Deux onglets ouverts sur la même tâche pour les épreuves de concurrence.

### Ce qui tient

| Épreuve                                                          | Résultat                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `document.modelContext` présent, `getTools()` trié par nom       | oui                                                                       |
| Budgets Chrome : nom / description / paramètre                   | 16 · 499 · 146 sur 30 · 500 · 150                                         |
| `untrustedContentHint` et `readOnlyHint` sur les quatre lectures | oui                                                                       |
| Cycle de vie : 0 tâche → 4 outils, tâche ouverte → 13            | oui                                                                       |
| Rejeu idempotent : même `mutation_id`, mêmes arguments           | réponse d'origine, « Nothing was written twice »                          |
| Même `mutation_id`, arguments différents                         | refusé, motif explicite                                                   |
| Version périmée                                                  | refusé, renvoie vers `what_changed`                                       |
| Conflit entre onglets                                            | message **distinct** : « Another page has since written v30 »             |
| Règle écrite par un agent                                        | arrive en PROPOSAL, non contraignante, visible à l'écran                  |
| Autorisation bloquante                                           | ALLOWED et DENIED font l'aller-retour ; le refus dit de ne pas contourner |
| `complete_task`                                                  | énumère ce qui reste non tranché avant de clore                           |
| Écriture après clôture                                           | refusée, avec la marche à suivre                                          |
| Réouverture                                                      | exige un motif écrit, et les outils d'écriture se réenregistrent aussitôt |
| Section `credentials`                                            | rend des noms, jamais une valeur                                          |
| Erreurs console sur toute la passe                               | aucune                                                                    |

### Deux trouvailles

**1. Deux outils de lecture débordent la borne de sortie de Chrome.** La garde
posée plus tôt ne mesurait que `resume_task`.

| Sortie                                 | Mesurée   | Face à 1,5 k |
| -------------------------------------- | --------- | ------------ |
| `resume_task`                          | 1528      | +2 %         |
| `what_changed`                         | 613       | tient        |
| `search_task`, cas ordinaire           | 811       | tient        |
| `search_task`, pire cas                | **6 296** | ×4,2         |
| `read_task_detail`, page de 20         | **1 989** | ×1,3         |
| `read_task_detail`, une entrée entière | **9 078** | ×6           |

La dernière est délibérée : l'outil existe pour rendre une preuve entière, et
`MAX_EVIDENCE_LENGTH` vaut 8000. Les deux autres ne sont bornées que par un
nombre d'entrées, jamais par des caractères — or une entrée peut être vingt fois
plus grosse qu'une autre.

**2. Aucun rafraîchissement entre onglets.** Le second onglet a rouvert la
tâche et écrit jusqu'à v31 ; le premier affichait encore v29 et « Task closed ».
Il ne l'apprend qu'en tentant d'écrire. La garantie de sûreté tient — rien n'est
écrasé en silence, et le refus nomme même l'autre page — mais l'écran ment
jusque-là, ce qui est exactement ce que ce produit reproche aux autres.
`visibilitychange` ne relit pas la base ; il redessine depuis la mémoire.

### Erreurs de sonde, consignées

**Deux versions devinées à tort.** Une décision d'autorisation incrémente
elle-même la version ; mes appels suivants portaient donc une version périmée.
Les refus étaient justes, la sonde non.

**« La réouverture ne fait rien » était de moi.** J'avais laissé le `prompt()`
en suspens pendant que je lançais d'autres outils ; la boîte de dialogue est
ressortie bien plus tard, derrière un appel sans rapport. Répondue tout de
suite, la réouverture fonctionne — et les neuf outils d'écriture se
réenregistrent dans la seconde.

## 28 août 2026 — les deux trouvailles, corrigées et revérifiées

**Poste.** Brave 151, deux onglets sur la même tâche, appels par
`execute_webmcp_tool`.

### La recherche se remplit maintenant jusqu'au budget

Douze correspondances de 240 caractères faisaient 6296 caractères. La borne
porte désormais sur les caractères et non sur le compte : **6296 → 1275**, et
l'en-tête dit « 2 shown of 30 found · 28 more not shown — narrow the query ».
Rien n'est caché, la recherche sert à trouver.

**Une borne que j'ai posée puis retirée.** J'avais borné `read_task_detail` de
la même façon. Une épreuve existante l'a refusé — et elle avait raison :
`resume_task` est le pointeur court, `read_task_detail` est là où l'on va
chercher du volume. Le borner rendait une à deux entrées par page dès qu'une
preuve était jointe. Le partage des rôles était délibéré ; je ne l'avais pas
reconnu avant que le test ne me le dise.

### Deux onglets restent en phase

Un `BroadcastChannel` annonce chaque écriture ; l'onglet qui tient la même tâche
la relit depuis IndexedDB et se redessine.

**Observé.** Onglet 2 écrit une règle. Onglet 1 passe de v32 à **v33** et
affiche la règle, **sans un clic ni un rechargement**. Aucune erreur console.

**Deux défauts trouvés en le construisant, dont un que la suite n'a pas vu.**

1. **L'écho.** Une réécriture par numéro de ligne avait transformé le
   `tasksChanged()` du récepteur en `tasksChangedEverywhere()` : chaque onglet
   réannonçait ce qu'il recevait, et deux onglets se seraient renvoyé le message
   sans fin. Attrapé par un test qui vérifiait ce qui était émis.

2. **L'onglet sourd — vu en navigateur seulement.** Le canal était ouvert
   paresseusement, à la première annonce. Or un onglet qui ne fait que lire
   n'annonce jamais rien : il restait donc sourd, et c'était exactement celui
   qu'il fallait réveiller. La suite ne pouvait pas le voir, parce que dans
   chacun de ses cas le magasin avait écrit avant d'écouter. Le canal s'ouvre
   maintenant à `init()`, et une épreuve part d'un magasin qui n'écrit pas une
   seule fois.

C'est la troisième fois dans ce projet qu'un test vert masque un défaut que le
navigateur montre en une minute.

## 28 août 2026 — passe de sécurité en WebMCP réel

**Poste.** Brave 151, deux onglets, appels par `execute_webmcp_tool`.

### Injection : ce qu'un agent écrit finit dans le DOM de l'humain

Une étape écrite **par un agent**, portant
`<img src=x onerror="window.__pwned=1">`, `<script>`, un `<iframe>` et un
`</pre>` destiné à sortir du bloc de preuve.

**Observé.** Rien d'exécuté — les quatre témoins restent `null`. Zéro `<img>`,
zéro `<script>`, zéro `<iframe>` dans `#app`. Le texte s'affiche tel quel, y
compris une fois la preuve dépliée. En position d'attribut (`aria-label`), les
guillemets sont échappés en `&quot;` ; en position de texte, ils ne le sont pas
— ce qui est correct, et non un oubli.

**Erreur de sonde.** Mon premier contrôle dé-échappait le HTML avant d'y
chercher des balises, et trouvait donc huit « balises vivantes » qui étaient les
entités échappées de ma propre charge. Le produit n'y était pour rien.

### Le coffre, jusque dans IndexedDB

Un identifiant scellé depuis l'écran, puis l'enregistrement brut relu.

| Question                           | Réponse                                       |
| ---------------------------------- | --------------------------------------------- |
| Champs stockés                     | `id, taskId, name, purpose, kind, sealed, at` |
| Valeur en clair dans le coffre     | non                                           |
| Passphrase en clair dans le coffre | non                                           |
| Valeur en clair dans la tâche      | non                                           |
| Contenu de `sealed`                | `{ciphertext: "…base64…"}`                    |

`read_task_detail` sur `credentials` rend `${gemini-api-key}` et sa raison
d'être, jamais la valeur. `search_task` sur la valeur elle-même : `NO MATCH`.

**Le lien partageable non plus.** 7005 caractères, décompressés en
19 589 caractères de JSON : ni la valeur, **ni même le nom**. Les secrets vivant
hors de `TaskState`, `packTask` ne peut pas les emporter — la garantie est
structurelle, et elle se vérifie sur l'octet.

**Passphrase.** Mauvaise : « That passphrase does not open this credential. »
Bonne : la valeur, avec « Hidden again in under a minute. »

**Le pire moment.** Avec la valeur affichée à l'écran, `resume_task` rend
toujours `CREDENTIALS — names only, values sealed (1)` et le seul `${nom}`.

**Mais la garantie est bien celle qui est écrite, pas plus.** La page dit :
« anything you reveal on screen can be read by an agent that drives this
browser ». C'est exact, et je viens d'en faire la démonstration involontaire :
j'ai lu la valeur révélée dans le DOM par `evaluate_script`. La promesse est
« aucun OUTIL ne rend une valeur », pas « aucun agent ne peut la voir ». Le
produit le dit ; il fallait le vérifier plutôt que le sur-vendre.

### La bombe de décompression, avec le vrai `DecompressionStream`

Corrigée au second audit, jamais vérifiée en navigateur jusqu'ici.

| Charge         | Mesure                                         |
| -------------- | ---------------------------------------------- |
| En clair       | 6 000 302 octets                               |
| Compressée     | 6 069 octets, ratio 989:1                      |
| Fragment       | 8 093 caractères — **sous** la borne de 16 000 |
| Verdict        | refusée en ~100 ms                             |
| Tas après coup | 4 Mo — les 6 Mo n'ont jamais existé            |

Message rendu : « That link does not carry a readable log. »

### Durabilité

`navigator.storage.persisted()` vaut `false` sur ce profil ; 0,54 Mo utilisés
sur 2 Go de quota. La page propose « Ask the browser to keep this » quand ce
n'est pas accordé, ce qui est le comportement attendu.

## 28 août 2026 — export, import, et la suppression d'un cahier

**Poste.** Brave 151. Le téléchargement est intercepté en enveloppant
`URL.createObjectURL`, l'import en construisant un `File` et un `DataTransfer` —
donc par les mêmes chemins que l'utilisateur.

### L'export

34 828 octets de Markdown, un seul bloc JSON. Il porte bien la charge
d'injection écrite plus tôt (c'est le contenu du cahier, il doit y être), et
**ni la valeur du secret ni même son nom**. Cohérent avec le lien partageable,
et pour la même raison structurelle.

### L'import, ses deux branches

| Fichier                              | Résultat                                                 |
| ------------------------------------ | -------------------------------------------------------- |
| Identique à ce qui est ici           | « 1 already here. » — rien n'est dupliqué                |
| Même identifiant, version différente | une COPIE, titrée « … (imported) », identifiant distinct |

Dans les deux cas l'original reste intact, et aucun secret ne revient par le
fichier.

### La suppression d'un cahier emporte ses identifiants scellés

C'était le défaut le plus grave du premier audit — `deleteSecretsForTask`
n'était jamais appelé, et un identifiant scellé survivait au cahier qui le
portait. Corrigé alors, jamais vérifié en navigateur jusqu'ici.

Relevé dans IndexedDB, de part et d'autre de la suppression :

|       | `tasks`                        | `secrets`                         |
| ----- | ------------------------------ | --------------------------------- |
| Avant | `289687a53a75`, `a36c38ba83a6` | `gemini-api-key` → `a36c38ba83a6` |
| Après | `289687a53a75`                 | _(vide)_                          |

Le cahier part, le secret part avec lui, et l'autre cahier n'est pas touché.

## 28 août 2026 — la page sur un écran étroit

**Poste.** Brave 151, viewport émulé 375 × 812, mobile et tactile. Jamais
vérifié jusqu'ici, et un juge ouvre ce qu'il veut.

**Ce qui tient.** Aucun débordement horizontal : `scrollWidth` vaut exactement
375, et **aucun** des éléments de `#app` ne dépasse la largeur du viewport. La
hauteur médiane d'une cible tactile est de 41 px.

**Ce qui ne tient pas, et n'est pas corrigé.** Quatre éléments passent sous une
cible confortable :

| Élément                                   | Hauteur   |
| ----------------------------------------- | --------- |
| `<select>` du type d'identifiant          | **19 px** |
| Les trois liens de la barre « Needs you » | **22 px** |

Le reste est à 41 px, soit juste sous les 44 px recommandés — un écart que je ne
compte pas comme un défaut. Les quatre ci-dessus, si. Non corrigé : la mise en
forme est un domaine où l'on ne touche pas sans décision, et ce n'est pas la
mienne à prendre.

## 28 août 2026 — sur une machine vingt fois plus lente

**Poste.** Brave 151, throttling CPU ×20 par CDP. Cahier de **3000 étapes,
60 règles, 1,27 Mo** — les mesures précédentes avaient toutes été prises sur une
machine rapide, ce qui ne prouve rien pour qui n'en a pas.

**Ce que la page rend.** 409 nœuds, 40 ko de HTML — les bornes tiennent, la
taille du cahier ne s'y voit pas. Une recherche sur « shard » trouve
3060 correspondances et n'en montre que ce qui tient dans le budget.

**Le coût réel, séparé de la cadence du compositeur.** Le travail synchrone du
gestionnaire de frappe est de 0 à 2,9 ms : il ne fait que programmer un rendu.
Le temps jusqu'à la peinture est de ~1005 ms, mais c'est la cadence d'un
compositeur à ×20, pas le produit — toute page la subirait.

Ce qu'il fallait mesurer, c'est le fil principal. Un `PerformanceObserver` sur
les `longtask` pendant six frappes :

|                                   | ms      |
| --------------------------------- | ------- |
| Tâche la plus longue              | **147** |
| Médiane                           | 136     |
| Tâches observées pour six frappes | **3**   |

147 ms à ×20 correspond à ~7 ms sur ce poste, ce qui recoupe la mesure directe
de 6,9 ms prise plus tôt sans throttling. Sur une machine vingt fois plus lente,
une frappe dans la recherche coûte donc ~140 ms de fil principal sur un cahier
de 1,27 Mo : perceptible, pas cassé.

Et **trois tâches pour six frappes** : le regroupement par `requestAnimationFrame`
fait son travail — taper vite ne produit pas un rendu par caractère.

**Erreur de sonde, consignée.** La première mesure portait sur le mauvais
cahier : `lastTaskId` avait été écrit pendant que la page était déjà montée, et
le rechargement a rouvert celui d'avant. Le chiffre de 1009 ms que j'ai lu là
était celui d'un cahier de dix étapes — il ne mesurait rien.

## 28 août 2026 — ce qu'un audit adversarial a trouvé dans le code d'il y a une heure

Neuf agents lancés en parallèle : trois sur le concours, trois en audit du code
écrit aujourd'hui, deux sur les surfaces non couvertes et le build de
production, un de synthèse. Ils ont trouvé **quatre défauts dans le
`BroadcastChannel` posé une heure plus tôt**, dont deux atteignables avec deux
onglets et un cahier de dix étapes.

### Le pire : une suppression pouvait être annulée par l'autre onglet

La suppression n'annonçait que « la liste a changé », sans nommer le cahier.
L'onglet d'à côté gardait donc à l'écran un cahier disparu — et sa prochaine
écriture le **ressuscitait**. `saveTask` traitait « aucun enregistrement » comme
« pas encore créé » et retombait sur le `put`.

Le cahier revenait avec toutes ses étapes et toutes ses preuves collées, mais
**sans ses identifiants scellés**, eux réellement effacés : l'humain croyait la
donnée partie, elle revenait amputée, et chaque référence `${name}` pendait dans
le vide. Sur l'opération que l'on fait précisément *parce qu'on veut que la
donnée disparaisse.

Le commit `26501e8` s'intitule « Verify … that deleting a task takes its
secrets ». Ce défaut le démentait dans le cas à deux onglets.

**Deux correctifs, les deux nécessaires.** La suppression nomme le cahier
(`{id, gone: true}`), et le récepteur passe en `missing`. Et `saveTask` refuse
désormais une écriture qui porte une version attendue contre un enregistrement
absent : une telle écriture est par définition une mise à jour, les créations
passent par le chemin sans version.

**J'avais écrit l'assertion inverse.** `test/migration-index.test.ts` affirmait
« laisse passer la toute première écriture d'un cahier qui n'existe pas ».
C'était mon raisonnement qui était faux, pas le code qui l'a suivi. Le test
affirme maintenant le contraire, avec la raison.

### Trois autres, dans le même fichier

- **La relecture ne revérifiait pas la liaison.** La garde « est-ce le cahier
  ouvert ? » était évaluée à la réception du message ; le travail, lui, était
  différé dans la file. Entre les deux, l'utilisateur peut ouvrir un autre
  cahier — et la relecture rebasculait l'écran, et `boundId`, sur le précédent.
  Pire que l'écran périmé que le canal devait supprimer.
- **Aucun regroupement.** Mesuré par l'agent sur 20 000 étapes : cinquante
  annonces coûtaient cinquante lectures et 1702 ms, dont 1668 jetés. Et comme la
  file est partagée avec les écritures locales, elles retardaient les écritures
  de cet onglet d'un facteur 51. Une seule relecture par cahier désormais.
- **La liste des cahiers se relisait à chaque écriture.** `listKey` contenait la
  version du cahier ouvert, qui change à chaque écriture : 61 ms et **15,9 Mo
  lus pour produire 9 ko de fiches**, sur 20 cahiers de 2000 étapes. Les lignes
  du sélecteur n'en dépendent pas.

### Vérifié à deux vrais onglets

Onglet 1 supprime. Onglet 2, **sans un clic ni un rechargement** :

> This task does not exist on this device. The address points at suppr0000001,
> which is not here. No other task has been opened in its place.

Puis un agent tente d'écrire depuis l'onglet 2 : refusé. Et sur le disque :
`tasks` vide, `secrets` vide. Le cahier ne revient pas.

### Un mutant survivant, non résolu

Retirer la revérification de liaison **à l'intérieur** de `resyncFromDisk` ne
fait rougir aucun test : la garde de la file la couvre en amont. Les deux ont
pourtant un rôle distinct — l'une évite la lecture, l'autre évite d'appliquer
une lecture périmée — et je n'ai pas su construire une course déterministe pour
la seconde. Elle reste, non couverte, et c'est écrit ici plutôt que maquillé.

### Un chiffre publié par le banc était faux

`bench/detail.bench.ts` chronométrait `normalizeTask(structuredClone(task))`,
attribuant à la normalisation le coût du clone : **3,94 ms de clone comptés dans
0,24 ms de normalisation**, à 4000 étapes. Un facteur seize, et il pointait vers
le mauvais correctif — « accélérer normalize » au lieu de « lire moins
souvent ». Le clone est sorti du chronomètre. Aucun document publié ne citait ce
chiffre ; seule la sortie du banc était fausse.

## 28 août 2026 — le build de production, et une promesse du README qui était fausse

Un agent d'audit a construit puis servi `dist/` depuis un serveur statique NU —
pas `vite preview`, qui réécrit tout seul et masquait tout. Trois problèmes,
tous invisibles en local.

### L'adresse profonde tombait sur un 404

La page déplace l'adresse vers `/t/:id` dès qu'un cahier est ouvert. Sur un
hôte sans réécriture, tout rechargement, tout signet et tout lien partagé
tombait sur le 404 de l'hébergeur. Vérifié : `curl http://127.0.0.1:8911/t/abc`
rend **404** sur un serveur nu, **200** sous `vite preview`.

`public/_redirects` et `vercel.json` posés. Un serveur statique nu ne les lit
pas — ce sont des conventions d'hébergeur — donc ce point reste à vérifier sur
l'hôte réellement choisi.

### Le service worker ne précachait rien de l'application

`SHELL` listait `/`, `/index.html`, le manifeste et une icône. Les deux
fichiers dont l'application est faite portent une empreinte dans leur nom : ils
ne peuvent pas être écrits à la main, et rien ne les injectait. L'enregistrement
se faisant sur `load`, la première visite ne passe pas non plus par le worker.
**Après une seule visite, hors ligne rendait une page blanche** — alors que le
README annonçait l'inverse, « verified with the server stopped ».

`scripts/precache.mjs` écrit désormais les vrais noms dans `dist/sw.js`, et
donne au cache un nom dérivé de leur contenu — sans quoi `activate` ne
supprimait jamais rien.

**Vérifié pour de bon, cette fois.** Serveur statique **arrêté**, réseau émulé
hors ligne, `fetch` d'une ressource non cachée qui **échoue** — et la page rend
957 caractères de contenu réel. Cache : cinq entrées, dont le JS et le CSS.

### Une page d'erreur pouvait empoisonner le cache pour de bon

La branche de navigation mettait la réponse en cache **sans contrôler son
statut**. Sur un hôte sans réécriture, le premier `/t/:id` rendait un 404 qui
était écrit par-dessus `/index.html` : le repli hors ligne servait ensuite ce
404 pour toute navigation, racine comprise. Et le nom du cache étant figé,
aucun déploiement ne le nettoyait. Le contrôle `response.ok` existait déjà sur
la branche des ressources ; il manquait sur celle des navigations.

### La carte de source partait en production

`npm run build` — ce que les hébergeurs détectent tout seuls — produisait une
carte de source de **519 ko**, plus lourde que tout le reste du site réuni, et
qui rend la source entière lisible par un agent pilotant le navigateur. Elle est
maintenant sur demande (`SOURCEMAP=1`). `dist/` passe de ~760 ko à **260 ko**.

## 29 août 2026 — le lien protégé par une phrase de passe

Un lien porte le cahier entier, et sa vraie fuite n'est pas le fragment — que
le navigateur ne transmet jamais — mais **l'endroit où on le colle** : un fil
Slack, un mail, une conversation qui garde le message.

**Ce qui a été construit.** Un second bouton, « Copy a protected link », qui
scelle le lien par une phrase de passe. Aucune cryptographie nouvelle : c'est
`seal`/`unseal` du coffre, AES-GCM 256 et PBKDF2-SHA256 à 600 000 itérations,
sel et IV tirés au hasard à chaque scellement. On chiffre **après** avoir
compressé, un chiffré ne se compressant pas.

**Ce que ça ne fait pas, et l'écran le dit.** Cela ne vérifie pas une identité.
Un fragment d'URL est une capacité au porteur, et authentifier quelqu'un
demanderait un serveur. Ce qu'une phrase prouve, c'est la connaissance d'un
secret — autre chose, et le maximum disponible sans serveur. Un mutant qui
remplace cette phrase par « We check who opens it » fait rougir la suite.

**Vérifié dans Brave 151, de bout en bout.**

| Étape                       | Observé                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Lien copié                  | 6852 caractères, marqueur `#log=s`, titre du cahier absent                                                      |
| Destinataire, appareil vide | « A protected log » — **rien n'est lisible, pas même le nom**                                                   |
| Mauvaise phrase             | « That passphrase does not open this link. Ask them to repeat it — the link itself is fine. » et le champ reste |
| Bonne phrase                | l'offre ordinaire, titre visible, « Take a copy »                                                               |
| Après ouverture             | le fragment a quitté la barre d'adresse                                                                         |

Taille : **1,82×** le lien ordinaire (3747 → 6821 caractères sur le cahier de
démonstration), très en deçà de la borne de 16 000.

**Erreur de sonde, consignée.** Ma première tentative montrait le cahier au
lieu de demander la phrase. J'avais vidé IndexedDB depuis la page **encore
montée** : le magasin, toujours en mémoire, a réécrit la tâche avant la
navigation. En passant d'abord par une page neuve, le comportement attendu
apparaît. Le produit n'y était pour rien.

## 29 août 2026 — le produit s'appelle Keydler

Renommage complet : « Watch Log » devient **Keydler**, sur keydler.com. Les
messages de commit antérieurs disent encore « Watch Log » ; c'est le même
produit.

**La règle appliquée.** La marque devient « Keydler » ; le nom commun devient
« log ». Sans cette distinction, un remplacement aveugle produisait « a readable
Keydler » là où la phrase disait « a readable watch log ». Trois tournures ont
dû être reprises à la main après coup — « The Keydler takes… » se lit mal pour
un nom propre.

**Une falsification, corrigée.** Le renommage a d'abord réécrit des
OBSERVATIONS antérieures : une entrée du 28 août faisait dire à une page
qu'elle s'intitulait « Keydler — … », alors qu'elle portait encore l'ancien
nom. Un audit l'a relevé. Les relevés antérieurs au 29 août citent de nouveau
les chaînes réellement observées ; c'est la même règle que pour
`chrome-watch-log`, et je l'avais appliquée là et pas ici.

**Ce qui n'a PAS été renommé, et pourquoi.** Trois clés persistées :

| Clé               | Où                                     | Conséquence d'un renommage                                     |
| ----------------- | -------------------------------------- | -------------------------------------------------------------- |
| `cahier-de-quart` | `DB_NAME`                              | tous les cahiers déjà sur les postes deviennent inatteignables |
| `watch-log.theme` | `theme.ts` et l'amorce de `index.html` | la préférence de thème est perdue                              |
| `watch-log:seen:` | `seen.ts`                              | « pendant votre absence » repart de zéro                       |

Un garde-fou dans le script de renommage vérifiait la survie de chacune, et
aurait interrompu le travail si l'une avait disparu.

Le nom du serveur MCP `chrome-watch-log` et les répertoires
`/tmp/watch-log-agent.*` cités dans les protocoles de mesure ne sont pas non
plus renommés : ce sont des faits de l'environnement de mesure, pas le nom du
produit, et les réécrire fausserait le protocole.

## 29 août 2026 — l'audit du renommage, et ce qu'il m'a repris

Quatre agents en parallèle sur le renommage. Deux de leurs reproches visaient
mon propre travail, et les deux étaient fondés.

### J'avais falsifié le journal

Le remplacement aveugle a réécrit des **observations** : une entrée du 28 août
faisait dire à une page qu'elle s'intitulait « Keydler — a shared memory… »,
alors qu'elle portait encore l'ancien nom ce jour-là. Quatre autres tournures
françaises étaient devenues « le Keydler », « un Keydler ».

C'est exactement la règle que j'avais appliquée pour `chrome-watch-log` et les
répertoires `/tmp/watch-log-agent` — ne pas réécrire un fait d'observation — et
que je n'avais pas appliquée ici. Les relevés antérieurs au 29 août citent de
nouveau les chaînes réellement observées, avec une incise qui date le nom.

### Neuf captures d'écran montraient encore l'ancien nom

Vérifié en ouvrant `docs/assets/shared-link.png` : « WATCH LOG » en exergue,
« The Watch Log keeps… » dans l'accroche, « A SHARED WATCH LOG » en titre de
carte — trois fois dans une seule image, sous une légende qui dit désormais
« A shared log ». Le commit de renommage n'avait touché aucun fichier image.

Les neuf ont été reprises dans Brave, à 1180 × 900 comme les originales
(`active-task` en pleine page). Les quatre autres — `activity`, `credentials`,
`disputed-step`, `human-intervention` — sont des recadrages de carte sans
exergue ; vérifié en ouvrant `human-intervention.png`, elles n'avaient rien à
reprendre.

### Cinq autres correctifs

- **La construction de production se taisait sans jeton d'origin trial.** Une
  variable mal orthographiée chez l'hébergeur produisait un site d'apparence
  saine où `document.modelContext` n'existe jamais, et toutes les vérifications
  restaient vertes. Elle échoue désormais, avec `ALLOW_NO_ORIGIN_TRIAL=1` comme
  échappatoire pour la vérification locale et l'intégration continue — c'est la
  construction de déploiement qui doit prouver que le jeton est arrivé.
- **`durability.ts` annonçait « This log takes … »** pour un chiffre qui vient
  de `navigator.storage.estimate()`, donc de TOUTE l'origine : tous les
  cahiers, le coffre, le cache du service worker. Le renommage avait transformé
  une phrase vague en phrase fausse. Corrigé en « Everything this site stores
  here takes … ».
- **`package.json`** portait encore une description en français avec l'ancien
  nom — invisible à une recherche sur « watch », et le dépôt part public.
- **Deux chaînes lues par un agent** disaient « log » là où « task » portait le
  sens : « This device holds no log yet » sous un en-tête `NO ACTIVE TASK`, et
  « Another log may be open elsewhere, but it is NOT this task » qui compare un
  journal à une tâche dans le message dont le seul rôle est d'empêcher un agent
  de reprendre le mauvais travail.
- **Aucune balise sociale ni canonique.** La réécriture SPA rend 200 sur
  n'importe quel chemin : sans canonique, chaque URL inventée est un doublon
  indexable. Ajoutées, avec `keydler.com` comme origine — le seul endroit du
  dépôt où une URL absolue est juste plutôt qu'une supposition d'hôte.

## 29 août 2026 — verrouiller le site pour de bon

Une page qui tient un coffre d'identifiants chiffrés et expose treize outils
appelables par un agent mérite mieux qu'une politique de principe.

**Ce que l'inventaire a montré.** Le produit est un cas rare : **zéro requête
réseau sortante**, aucune police externe, aucune image `data:`, et **pas un seul
attribut `style=`**. Un seul script en ligne — l'amorce de thème, qui doit
s'exécuter avant la première peinture. La politique peut donc partir de
`default-src 'none'` et n'ouvrir que cette origine.

```
default-src 'none'; script-src 'self' 'sha256-…'; style-src 'self';
img-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self';
form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none';
upgrade-insecure-requests
```

Le script en ligne passe par son **empreinte**, jamais par `unsafe-inline` —
qui viderait la politique de tout son intérêt d'un seul mot.
`scripts/headers.mjs` calcule l'empreinte sur le HTML réellement construit, la
substitue dans `dist/_headers`, et **refuse la construction** si `vercel.json`
n'en porte pas la même : une politique qui a dérivé entre deux hébergeurs
rassure sans protéger.

S'y ajoutent HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
no-referrer` — les adresses portent des identifiants de tâche —, les deux
politiques `Cross-Origin-*`, et un `Permissions-Policy` qui refuse les dix-sept
capacités que le produit n'utilise pas.

### L'épreuve : la politique refuse-t-elle vraiment ?

`dist/` servi par un serveur qui applique réellement `_headers` — un serveur
statique ordinaire ne les lit pas, et l'on vérifierait alors une politique que
le navigateur ne reçoit jamais.

| Attaque                                        | Résultat    |
| ---------------------------------------------- | ----------- |
| Script en ligne injecté (le vecteur d'une XSS) | **refusé**  |
| Script chargé depuis un CDN                    | **refusé**  |
| `fetch` sortant vers une autre origine         | **refusé**  |
| Image-balise emportant le titre de la page     | **refusée** |
| Cadrage de la page (clickjacking)              | **refusé**  |

Chacune avec le message de refus du navigateur en preuve. Et l'application,
elle, fonctionne entièrement sous cette politique : cahier créé, règle écrite et
affichée, recherche, thème, service worker actif — **aucune erreur ni aucun
avertissement de console** avant les attaques délibérées.

### Ce qui n'a pas été fait, et pourquoi

**Trusted Types** (`require-trusted-types-for 'script'`) serait le cran
au-dessus. Le rendu repose entièrement sur `innerHTML` ; l'activer casserait
tout. À faire le jour où le rendu changera, pas six jours avant une échéance.

**`preload` sur HSTS** n'est pas posé : l'inscription à la liste de préchargement
est difficile à défaire, et ce n'est pas une décision à prendre à la place de
quelqu'un.

**Erreur de sonde, consignée.** Un mutant sur `default-src` a d'abord survécu.
Il avait frappé le **commentaire** qui cite la directive, pas la directive.
Visé sur la bonne ligne, il meurt. Et une de mes épreuves était creuse —
`empreintes.length + 1 === 1 + empreintes.length` est vrai de tout nombre ;
réécrite pour comparer la directive entière.

## 29 août 2026 — le premier déploiement réel, et ce qu'il a révélé

Publié sur Cloudflare Pages, puis vérifié à froid dans Brave contre
`https://keydler.pages.dev` — pas un `dist/` servi localement.

### Ce que l'hébergeur fait vraiment

| Vérification                                          | Résultat                                              |
| ----------------------------------------------------- | ----------------------------------------------------- |
| Les neuf en-têtes de sécurité sont servis             | oui, identiques au dépôt                              |
| La CSP porte l'empreinte du script d'amorce           | `sha256-2MrDQX8a64K4rJscRFFoIUoixVRRP8gk2kHbN6aUmNk=` |
| `/t/abc123` sur une URL jamais visitée                | **200**, pas 404 — le repli SPA fonctionne            |
| Messages de console sur toute la session              | **aucun**                                             |
| Le service worker précharge les vrais noms construits | `index-CEbglE2i.js`, `index-DOYQxzjx.css`             |
| Rechargement réseau coupé                             | la page se charge, les 13 outils s'enregistrent       |
| Écriture d'agent pendant la coupure                   | acceptée                                              |

Cloudflare remplace le `no-cache` d'`index.html` par
`public, max-age=0, must-revalidate`. Effet équivalent : revalidation à chaque
fois. Laissé tel quel.

### Trois défauts trouvés en production, qu'aucune épreuve ne couvrait

C'est la quatrième fois de ce projet qu'un navigateur réel trouve en une minute
ce que 868 épreuves vertes laissaient passer.

`set_next_action` était la seule écriture d'agent qui ne transmettait pas sa
version au domaine. Elle validait la **forme** du champ `based_on_version`, puis
en jetait la valeur.

1. **Une écriture périmée passait.** `based_on_version: 2` accepté alors que
   l'état était en v4. Un agent tenant une vieille lecture écrasait la prochaine
   action que l'humain venait de poser, sans refus.
2. **L'entrée était signée `human`.** Le registre — la seule chose que ce
   produit promet d'être honnête — attribuait à l'humain une écriture qu'aucun
   humain n'avait faite. Un agent relisant l'historique en conclut « l'humain a
   changé de direction pendant que je travaillais » et s'y range.
3. **Un nom quand elle réussit, un autre quand elle échoue** : `set_next` appliqué,
   `set_next_action` refusé. Le nom de l'outil n'apparaissait donc que sur les
   échecs. `changes.ts` listait déjà les deux, ce qui montre que la duplication
   avait été **contournée** plutôt que corrigée.

Constaté sur le registre du cahier de production `abf4be0acb7c`, avant
correction :

```
- set_next_action · agent · v4 · refused
    next: not-a-string
- set_next        · human · v4 → v5 · applied     ← écriture d'agent, signée humain
    Point the apex DNS record at the Pages project
```

Après correction et redéploiement, la même séquence sur le même cahier :

```
- set_next_action · agent · v5 · refused
    stale write on v2, current v5
- set_next_action · agent · v5 → v6 · applied
    Point the apex DNS record at the Pages project
```

Les deux entrées cohabitent dans ce registre : l'ancienne écrite par la version
boguée, la nouvelle par la version corrigée.

`setNext` prend désormais la même forme `(input, actor)` que tous les autres
mutateurs. Sept épreuves, cinq mutants tués — dont les trois défauts d'origine.
L'`undo` accepte encore l'ancien nom d'opération, pour ne pas retirer
l'annulation aux cahiers écrits avant le renommage.

### Ce qui n'est pas fait

**Le domaine `keydler.com` n'est pas encore servi.** Il est rattaché au projet
Pages, mais sa zone porte un enregistrement A périmé qui proxie vers une origine
morte (`error code: 521`). Mon jeton a `zone (read)` et la lecture des
enregistrements DNS a été refusée : je ne peux pas le corriger. Le domaine reste
en `pending` côté Pages tant que ce n'est pas fait.

**Le jeton d'origin trial n'est pas dans cette construction** — il n'est pas
encore enregistré. La vérification ci-dessus s'appuie donc sur Brave lancé avec
`--enable-features=WebMCP,WebMCPTesting`, comme toutes les précédentes, et **ne
démontre pas** que WebMCP s'activera pour un juge sur un navigateur ordinaire.
C'est ce que le jeton apportera, et il reste à poser.

### 29 août 2026, plus tard — « l'origine est morte » était faux

J'ai affirmé, ici et dans un message de commit, que l'enregistrement DNS de
`keydler.com` pointait vers une origine morte, et j'en ai tiré qu'un
contournement par route Worker ne risquait rien puisqu'il n'y avait « rien à
casser ». Une relecture adverse a contredit la prémisse. Mesuré :

```
https://keydler.com  → 521
http://keydler.com   → 302 → http://www.keydler.com → 200
                       « Site en construction », en-têtes x-iplb-* (OVH)
```

Cloudflare joint l'origine sans peine en clair. Le 521 est un **défaut TLS**
entre Cloudflare et OVH, pas une machine éteinte. Trois conséquences :

1. l'enregistrement pointe vers une installation OVH vivante. La remplacer est
   une décision à prendre, pas un nettoyage à faire ;
2. « Always Use HTTPS » est **désactivé** sur la zone — sinon le http n'aurait
   jamais atteint l'origine ;
3. un motif de route sans schéma intercepte aussi le http. Le jeton d'origin
   trial étant lié à `https://keydler.com`, une page servie en clair
   fonctionnerait parfaitement et n'exposerait **aucun** outil WebMCP. Un juge
   lirait « WebMCP is not available » sur un site d'apparence saine.

C'est le troisième point qui compte : le contournement transformait un échec
bruyant — un 521 que personne ne peut manquer — en échec silencieux, pendant
la période de jugement. Les routes portent désormais leur schéma, mais le
montage reste **préparé et non recommandé**, pour une raison que la relecture
a mieux formulée que moi : il ferait de l'enregistrement OVH le pilier porteur
du site, et survivrait à la correction du DNS en la masquant.

**Ce qui a rendu l'erreur possible.** J'ai sondé `https://` et conclu sur
`keydler.com`. Une seule requête en clair suffisait à me détromper, et je ne
l'ai pas faite avant d'écrire une conclusion dans le dépôt.

### Un refus utile, découvert en déployant

Le déploiement a échoué avant tout cela, pour une raison sans rapport et
instructive : le validateur d'assets de Workers **refuse** la réécriture SPA
`/*  /index.html  200` de `_redirects`, qu'il tient pour une boucle infinie —
là où Pages l'accepte. Deux validateurs, deux avis, sur le même fichier.

Le Worker n'en a pas l'usage : `not_found_handling` fait le même travail.
`public/.assetsignore` retire donc `_redirects` de cette livraison-là, sans
toucher à celle de Pages, qui n'envoie pas les fichiers commençant par un
point. Vérifié en local : `/t/abc123` rend 200 et porte la CSP.

Rien n'a été attaché à la zone : zéro route, aucun déploiement, `keydler.com`
inchangé.

### Un harnais de mutation qui mentait

Les premières mutations du Worker de redirection ont rapporté quatre
survivants. Les quatre portaient des apostrophes, qui refermaient la chaîne du
shell : les commandes n'ont jamais tourné, et le harnais a compté leur absence
d'effet comme une survie. Un harnais qui ne vérifie pas que la mutation s'est
appliquée mesure sa propre plomberie. Corrigé — il compare le fichier avant et
après, et refuse de conclure si rien n'a changé. Neuf mutants, neuf tués.

### 29 août 2026, fin de journée — keydler.com sert le site

L'enregistrement DNS a été corrigé à la main : `keydler.com` est un CNAME
proxifié vers le projet Pages. Le contournement par route Worker n'a donc pas
lieu d'être, et rien n'a jamais été attaché à la zone. Vérifié à froid dans
Brave, contre le domaine réel :

| Vérification                                | Résultat                             |
| ------------------------------------------- | ------------------------------------ |
| `https://keydler.com`                       | **200**, les neuf en-têtes servis    |
| `/t/abc123`, jamais visité                  | **200** — repli SPA                  |
| `http://keydler.com`                        | **301** vers https                   |
| `https://www.keydler.com/t/abc?source=chat` | 301, **chemin et requête préservés** |
| En-têtes `x-iplb-*` (OVH)                   | **absents** — sorti du chemin        |
| Domaine côté Pages                          | `active`, certificat `active`        |
| Outils WebMCP, cahier ouvert                | **13**                               |
| Rechargement réseau coupé                   | 13 outils, page servie du cache      |
| Messages de console, session entière        | **aucun**                            |

L'URL rendue par `resume_task` porte l'origine canonique — c'est elle que
transportera un lien partagé.

**La correction du jour, visible sur le domaine.** Un `set_next_action` sur une
version périmée est refusé (`stale write on v2, current v3`), et l'interface
l'annonce à l'humain sous le nom de l'outil : « An agent called
`set_next_action` just now — and it was refused ». Ce matin, la même action
réussie apparaissait sous `set_next`, signée `human`.

**Ce qui reste, et qui est bloquant.** Le jeton d'origin trial n'est pas
enregistré. Toute la vérification ci-dessus s'appuie sur Brave lancé avec
`--enable-features=WebMCP,WebMCPTesting`. Elle **ne démontre pas** qu'un juge
sur un navigateur ordinaire verrait le moindre outil. C'est le seul point qui
sépare encore ce déploiement d'une candidature défendable.

### 29 août 2026, soir — WebMCP s'active sans drapeau, et c'est démontré

Le jeton d'origin trial est enregistré, déployé, et **vérifié dans un navigateur
qui n'a aucun drapeau WebMCP**. C'est la première vérification de tout ce projet
qui ne dépend pas de `--enable-features=WebMCP,WebMCPTesting` — toutes les
précédentes en dépendaient, et je l'ai dit à chaque fois.

Le jeton, lu avant d'être utilisé :

```
origine        https://keydler.com:443
fonctionnalité WebMCP
third-party    non        sous-domaines  non
expire         2026-11-17
```

Soit 75 jours après le gel du 3 septembre, 57 après la fin du jugement.

**L'expérience de contrôle**, qui est ce qui rend la démonstration concluante.
Brave 152.1.94.117 (Chromium 152), profil neuf, lancé avec pour seuls drapeaux
`--remote-debugging-port=9223 --user-data-dir=… --no-first-run`. Aucun
`--enable-features`.

| Origine                     | Balise servie | `document.modelContext` |
| --------------------------- | ------------- | ----------------------- |
| `https://keydler.com`       | le jeton      | **existe** — 13 outils  |
| `https://keydler.pages.dev` | le même jeton | **absent**              |

Même construction, même navigateur, même session, même jeton dans le HTML : la
seule différence est l'origine à laquelle le jeton est lié. Chromium le rejette
sur l'autre, **sans rien dire**. C'est le mode d'échec que je redoutais depuis
le début, ici constaté plutôt que supposé — et la preuve que c'est bien le
jeton, et non un réglage du navigateur, qui active la fonctionnalité.

Boucle d'agent complète sur `keydler.com` dans ce navigateur : `resume_task`
rend l'état, `log_step` écrit, aucun message de console.

**Conséquence à ne pas oublier :** `keydler.pages.dev` n'a plus WebMCP. Ce
n'était pas le cas ce matin, où le drapeau masquait la différence. Cette
origine reste une surface de repli pour l'interface, pas pour les outils, tant
qu'un second jeton n'y est pas posé.

### Le jeton est versionné, à dessein

`.env.production` est le seul fichier `.env` suivi par git. Un jeton d'origin
trial n'est pas un secret — il est imprimé dans le HTML de chaque page servie.
Ce que le versionner protège, c'est la capacité à reconstruire exactement
l'artefact déployé à partir du seul dépôt, ce qui compte pendant un gel où l'on
ne peut plus rien rattraper.

### 29 août 2026, tard — `/workspace` est en ligne

Ce que doit atteindre un bouton « Sign in » sur un produit sans compte ni
serveur. Déployé et vérifié à froid sur `https://keydler.com/workspace`, dans
un Brave lancé **sans aucun drapeau WebMCP** — profil neuf, supprimé après.

| Vérification                                 | Résultat                        |
| -------------------------------------------- | ------------------------------- |
| L'adresse survit au rechargement direct      | `/workspace`, titre correct     |
| Export et import présents hors d'un cahier   | les deux                        |
| Dit qu'il n'y a ni compte ni serveur         | oui                             |
| Avertit que vider le navigateur efface tout  | oui                             |
| Ne dit plus « not even us »                  | oui                             |
| Outils WebMCP (origine vierge, aucun cahier) | 4 — les lectures, comme attendu |
| Messages de console                          | aucun                           |

Le rechargement direct est le cas qui compte : c'est ainsi qu'arrive quelqu'un
depuis une page d'accueil, et c'est ce que `reflectAddress` écrasait.

**Ce que la mesure a tranché.** La page conseille un fichier plutôt qu'un lien,
et ce n'est pas une préférence : un cahier de 60 pas fait 17 349 caractères
scellés contre 16 000 que tient une adresse ; le même en fichier fait 85 657,
sans limite. Un lien ne porte pas un cahier réellement utilisé, encore moins un
espace de travail. Toute conception qui aurait reposé sur « emporte ton compte
dans un lien » était morte avant d'être écrite.

**Deux affirmations retirées en cours d'écriture.** « Nobody else can read it —
not even us » est une promesse sur la confiance : nous servons le code, donc
nous pourrions le changer. Ce qui est démontrable — et vérifié dans le
navigateur, **zéro** requête `xhr`, `fetch` ou `websocket` — c'est qu'il n'y a
aucune destination et que la politique bloque les autres origines. Et rien ne
prétend que les cahiers sont chiffrés : seuls le coffre d'identifiants et les
liens scellés le sont, IndexedDB garde les cahiers en clair. Les deux sont
tenues par des épreuves.

**Une branche retirée plutôt que défendue.** Le rafraîchissement de la liste
portait un cas « aucun cahier ouvert alors qu'il en existe ». Cet état est
inatteignable — `init()` rouvre le dernier, `deleteCurrentTask()` en rouvre un
autre — et un mutant y a survécu. La branche est partie, et l'épreuve qui
prétendait la couvrir dit maintenant ce qu'elle prouve réellement.
