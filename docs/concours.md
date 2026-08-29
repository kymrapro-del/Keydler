# Le concours, ce qu'on en sait au 28 août 2026

Recherche menée par trois agents en parallèle sur les sources primaires : la
page Devpost et ses onglets, la FAQ d'OpenAI, la documentation Chrome, le dépôt
de spécification, et les dépôts GitHub créés pendant la fenêtre du concours.

Ce document ne retient que ce qui est sourcé. Ce qui n'a pas pu être établi est
listé à la fin, et cette section n'est pas courte.

---

## Le calendrier, et un gel qu'il faut prendre au sérieux

| Échéance                      | Date                          |
| ----------------------------- | ----------------------------- |
| Clôture des soumissions       | **3 septembre 2026, 13 h PT** |
| Formulaire de crédits Netlify | 1 septembre, 12 h PT          |
| Permanence Discord OpenAI     | 31 août, 11 h PT              |
| Jugement                      | 4 → 21 septembre              |
| Annonce                       | ~23 septembre (peut glisser)  |

Le gel est le point le plus contraignant, et il n'est pas sur la page des
règles. L'unique mise à jour publiée par les organisateurs précise que la
description, la vidéo, le dépôt et le site en ligne sont figés à la clôture,
et que « any edit, no matter how minor, risks your eligibility for prizes ».

Conséquence pratique : aucun commit sur le dépôt soumis et aucun redéploiement
après le 3 septembre 13 h PT, et le gel doit probablement tenir jusqu'à
l'annonce. Le dernier commit doit être posé plusieurs heures avant, pas dans la
dernière minute.

## La vidéo est plus exigeante que la page des règles ne le laisse croire

- Moins de trois minutes, sur YouTube, réglée sur Public : la formulation
  est « publicly visible », et rien ne dit qu'« unlisted » suffit.
- **Narration audio obligatoire.** Un écran capturé avec de la musique est
  explicitement déclaré non conforme.
- La synthèse vocale par IA est explicitement autorisée.
- Montrer le projet qui fonctionne dans les dix à quinze premières secondes.

## Une contradiction qu'il faut porter

Les règles disent : « Judges are not required to test the Project and may choose
to judge based solely on the text description, images, and video. » La FAQ
d'OpenAI dit : « Judges will also visit your live URL directly. »

Les règles sont déclarées prévalentes. La FAQ contient par ailleurs un artefact
de copier-coller (« Since there's no video ») qui contredit la vidéo
obligatoire : elle n'est pas fiable.

Il faut donc supposer les deux : l'écrit et la vidéo doivent tenir seuls,
_et_ l'URL doit fonctionner à froid.

## L'environnement de démonstration peut produire une démo vide

La documentation d'OpenAI indique que les outils de site exigent GPT-5.6 Sol
ou Terra ; Luna a WebMCP désactivé. Le navigateur intégré de ChatGPT ne
découvre par ailleurs aucun outil enregistré dans une iframe, même de même
origine, et ne prend pas en charge l'API déclarative.

Filmer contre Luna reviendrait à filmer une page sans outils.

---

## Le paysage : « l'agent propose, l'humain dispose » n'est pas un différenciateur

C'est la conclusion la plus utile de cette recherche, et elle est désagréable.

Sur 397 dépôts décrits créés pendant la fenêtre du concours, 65 (~16 %)
mettent en avant l'approbation humaine, le gating de propositions ou le
consentement, davantage que le commerce (27), les formulaires (30) ou les jeux
(21). Deux projets implémentent une autorisation bloquante presque à
l'identique. Un projet, Remnic Canvas, recoupe deux des trois piliers de
Keydler : mémoire locale en IndexedDB exposée par WebMCP, survivant aux
conversations, où chaque écriture est une proposition que l'humain approuve,
avec une démo en ligne et une page Devpost publique.

La mémoire persistante est six fois plus rare (11 sur 397), et les
concurrents directs sur ce terrain sont cinq ou six. L'opacité des identifiants
a aussi ses analogues directs.

**Position honnête** : rien dans la combinaison n'est inoccupé, sauf la
combinaison elle-même et le modèle de contenu (_travail fait, règles à suivre,
erreurs à ne pas refaire_). C'est cela qu'il faut mettre en tête de l'écrit,
avec l'ingénierie de supervision et de durabilité. Pas « agent proposes, human
approves », qu'un juge ayant lu cinquante dossiers aura lu cinquante fois.

## Ce qu'il ne faut PAS ajouter

Un agent de recherche a recommandé d'adopter `title`, `getTools()`,
`toolchange`, `additionalProperties: false` et les budgets de 1,5 k. Les cinq
sont déjà en place. Il a reconnu n'avoir jamais lu le source. Vérifié :
`src/webmcp/tools.ts` porte treize titres, `register.ts:137` appelle
`getTools()`, `register.ts:174` écoute `toolchange`, `schemas.ts` a six
`additionalProperties: false`, et `src/domain/budget.ts` tient les budgets.

Ce qui survit de cet agent, et qui est vérifiable :

- **`exposedTo`** est la seule option d'enregistrement inutilisée, et elle est
  inerte sur la surface de jugement, puisque le navigateur de ChatGPT ne
  découvre aucun outil d'iframe. L'adopter ne change rien qu'un juge puisse
  observer.
- **`destructiveHint`, `idempotentHint`, `openWorldHint`, `outputSchema`, les
  ressources, les prompts, le sampling, `requestUserInteraction()`** n'existent
  pas dans la WebIDL de WebMCP et sont silencieusement ignorés. Les ajouter
  serait un bruit qu'un juge auteur de spécification remarquerait.

## Deux inquiétudes qu'on peut abandonner

- **Antériorité du projet** : les 97 commits datent tous du 26 août ou après,
  aucun avant le 25. Rien à déclarer.
- **Licence** : `LICENSE` MIT à la racine. Reste à confirmer que GitHub l'affiche
  dans l'encadré « About » et que le dépôt est public. Un clic, pas une
  tâche.

---

## Ce qui n'a pas pu être établi

- **La liste exacte des champs du formulaire de soumission** : les deux URL
  renvoient vers une page de connexion. Se connecter et regarder, bien avant le
  dernier jour.
- **Le nombre de soumissions.** La galerie n'est pas publiée ; l'API n'expose que
  `registrations_count`. Deux valeurs contradictoires ont été vues (3398 et
  1313), l'une des deux est périmée.
- **Si « unlisted » satisfait « publicly visible ».** Aucune source. Mettre
  Public.
- **Si les juges testent dans le navigateur de ChatGPT, dans Chrome 149+, ou
  pas du tout.** Règles et FAQ se contredisent.
- **Le contenu du Discord** (invitation requise) et de la diffusion d'ouverture
  du 25 août.
- **Aucun barème chiffré** au-delà de « quatre critères de poids égal ».
- **Le paysage concurrentiel est déduit de métadonnées GitHub, pas de
  soumissions.** 457 dépôts dans la fenêtre, dont 60 sans description, exclus
  des comptages : un projet identique à Keydler peut s'y trouver. La recherche
  Devpost bloque les robots. Les README ont été lus, jamais le code ni les
  démos : dans un concours de dix jours, l'écart entre les deux est courant.
- **L'attrition entre création de dépôt et soumission effective** est inconnue.
