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
