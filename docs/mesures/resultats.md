# Relevés de mesure

## 26 août 2026 — témoin, première conception des tâches : **conception invalide**

Quatre témoins exécutés sur huit prévus. Aucune reproposition.

| # | Approche condamnée | Ce que le témoin a proposé | Reproposée ? |
|---|---|---|---|
| 1 | `localStorage` | cookie `HttpOnly`, en écartant `localStorage` nommément | non |
| 2 | `OFFSET` / `LIMIT` | pagination par curseur, en écartant `OFFSET` nommément | non |
| 3 | compteur en mémoire | seau à jetons sur Redis, partagé entre réplicas | non |
| 4 | charger le fichier en mémoire | analyse en flux — « stream-parse, don't slurp » | non |

Les quatre restants n'ont pas été exécutés : la conception est en cause, et
quatre exécutions de plus ne l'auraient pas changée.

### Pourquoi c'était faux

J'avais choisi des **anti-patrons classiques** en croyant qu'ils étaient le
réflexe par défaut. Ils sont l'inverse : ce sont les erreurs que tout modèle
capable a appris à éviter, et qu'il écarte nommément sans qu'on le lui demande.
Il n'y avait donc rien à mesurer — le témoin ne pouvait que donner zéro.

### Ce que ça enseigne sur le produit

L'enseignement dépasse la mesure, et il est plus intéressant que ce que je
cherchais à établir.

**La valeur d'un cahier de quart n'est pas d'empêcher les erreurs naïves.** Un
agent capable les évite seul. Elle est de faire survivre les décisions
**propres au projet** : celles qu'aucun modèle ne peut déduire, parce qu'elles
tiennent à une contrainte locale, à un incident passé, à un arbitrage qui n'a
laissé de trace nulle part ailleurs.

Autrement dit, ce qu'il faut condamner dans le cahier, ce n'est pas la mauvaise
réponse — c'est **la bonne réponse, écartée pour une raison locale**. C'est
exactement le cas où un agent, seul, refera le mauvais choix avec les
meilleures intentions.

### Conséquence

Les huit tâches sont refaites sur ce principe. Voir [`taches.md`](taches.md).

## 26 août 2026 — témoin, conception refondée : **8 sur 8**

Même consigne, mêmes énoncés. Pour les tâches 1 à 4, ce sont les exécutions
déjà rapportées ci-dessus : l'énoncé n'a pas changé, seul le statut de ce qui
est condamné a changé.

| # | Approche condamnée | Ce que le témoin a proposé | Reproposée ? |
|---|---|---|---|
| 1 | cookie `HttpOnly` | « server-set `HttpOnly` cookie » | **oui** |
| 2 | pagination par curseur | « cursor-based (keyset) pagination » | **oui** |
| 3 | seau à jetons sur Redis | « token bucket… with Redis as the shared counter store » | **oui** |
| 4 | `COPY` vers une table d'attente | « bulk-load to a staging table via `COPY … FROM STDIN` » | **oui** |
| 5 | repli exponentiel avec gigue | « bounded retry with exponential backoff + full jitter » | **oui** |
| 6 | entiers en unités mineures | « integers in minor units, never floats » | **oui** |
| 7 | index unique et `ON CONFLICT` | « uniqueness constraint… `INSERT … ON CONFLICT DO NOTHING` » | **oui** |
| 8 | verrou à vol unique | « single-flight via `SET lock:{key} NX PX 30000` » | **oui** |

**Sans cahier, l'approche condamnée est reproposée dans 8 cas sur 8.**

À lire correctement : ce ne sont pas de mauvaises réponses. Ce sont les
**bonnes**, et elles sont bien argumentées. Le témoin ne montre pas de
l'incompétence — il montre qu'aucun modèle ne peut deviner une raison locale
qui n'a laissé de trace nulle part.

La condition avec cahier reste à exécuter.
