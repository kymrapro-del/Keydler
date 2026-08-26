# Les huit tâches de mesure

> **Principe.** L'approche condamnée est la **bonne réponse** — celle qu'un
> modèle capable propose de lui-même — écartée pour une raison **propre au
> projet**, qu'aucun modèle ne peut déduire.
>
> C'est le seul cas qui mérite d'être mesuré. Les anti-patrons classiques, un
> agent les évite seul : une première conception bâtie sur eux a donné un
> témoin à zéro, consigné dans [`resultats.md`](resultats.md).

Pour les tâches 1 à 4, l'approche condamnée n'est pas supposée : c'est
**exactement** ce que le témoin a proposé lors de l'exécution du 26 août.

| #   | Tâche                             | Approche condamnée              | Motif consigné (local, indéductible)                                                                                     | Contrainte                                |
| --- | --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 1   | Conserver un jeton de session     | cookie `HttpOnly`               | l'API est sur un autre domaine apex, et la vue web mobile rejette les cookies tiers — essayé, les sessions tombaient     | aucune dépendance nouvelle                |
| 2   | Paginer un endpoint volumineux    | pagination par curseur          | la console d'administration doit sauter à une page arbitraire, ce que le curseur rend impossible                         | ne pas changer la forme de l'API publique |
| 3   | Limiter le débit d'une API        | seau à jetons sur Redis         | il n'y a pas de Redis et l'exploitation refuse d'en ajouter un                                                           | aucune infrastructure nouvelle            |
| 4   | Insérer un CSV volumineux         | `COPY` vers une table d'attente | l'utilisateur de base n'a pas le droit `COPY` sur ce cluster                                                             | plafond mémoire de 512 Mo                 |
| 5   | Réessayer un appel amont          | repli exponentiel avec gigue    | la fenêtre d'idempotence du prestataire est de 30 s ; le repli poussait les réessais au-delà, d'où des double-débits     | ne pas ajouter de file d'attente          |
| 6   | Représenter des montants          | entiers en unités mineures      | on règle dans une devise à trois décimales avec des taux à quatre — les centimes perdaient la précision au rapprochement | aucune dépendance nouvelle                |
| 7   | Dédupliquer des travaux           | index unique et `ON CONFLICT`   | la table est partitionnée par mois, et un index unique inter-partitions n'est pas supporté sur ce cluster                | conserver la table existante              |
| 8   | Mettre en cache un calcul coûteux | verrou à vol unique             | le calcul dure 90 s et le verrou retenait les fils de requête jusqu'à épuisement du pool                                 | aucune dépendance nouvelle                |

## Énoncés exacts

1. Persist the user's session token in our browser application.
2. Add pagination to the `/api/orders` listing endpoint, which returns a large result set.
3. Add rate limiting to our HTTP API.
4. Process an uploaded CSV file of customer records and insert the rows into the database.
5. Make our calls to the upstream payments provider resilient to intermittent failures.
6. Store monetary amounts for invoices and their line items.
7. Make sure a job is not processed twice when it is enqueued more than once.
8. Cache the result of an expensive report computation.

## Consigne du témoin

L'énoncé, et rien d'autre : ni contrainte, ni rejet. C'est l'état où la
conversation précédente a été perdue et où rien n'a survécu.

```
Answer directly from your own knowledge. Do NOT use any tool.

You are picking up this task: <énoncé>

Propose concretely how you would do it. Name the specific
technique or mechanism you would use. Keep your answer under
150 words.
```

## Consigne de la condition avec cahier

Le cahier porte la tâche, sa contrainte active et son approche condamnée
motivée. La consigne d'ouverture est la même que dans tous les essais du J3 :

```
continue
```

## Relevé

Est comptée comme reproposition toute réponse retenant le mécanisme condamné
comme **solution principale**. Le mentionner pour l'écarter n'en est pas une.
