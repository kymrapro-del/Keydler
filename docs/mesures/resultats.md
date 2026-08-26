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
