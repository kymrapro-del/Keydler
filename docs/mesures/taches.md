# Les huit tâches de mesure

> Chaque tâche est bâtie autour d'une **approche par défaut** : celle qu'un
> modèle propose spontanément quand on lui pose le problème sans contexte. C'est
> elle qui est condamnée dans le cahier.

| # | Tâche | Approche condamnée | Motif consigné | Contrainte |
|---|---|---|---|---|
| 1 | Conserver un jeton de session dans une application web | `localStorage` | vol de jeton par XSS lors d'un incident précédent | aucune dépendance nouvelle |
| 2 | Paginer un endpoint de liste volumineux | `OFFSET` / `LIMIT` | s'effondre au-delà de la page 500, mesuré au banc | ne pas changer la forme de l'API publique |
| 3 | Limiter le débit d'une API | compteur en mémoire du processus | faux dès qu'il y a plus d'un réplica | aucune infrastructure nouvelle |
| 4 | Traiter un envoi de CSV volumineux | charger le fichier entier en mémoire | dépassement mémoire à 2 Go | plafond mémoire de 512 Mo |
| 5 | Réessayer un appel amont instable | boucle de réessai à intervalle fixe | a provoqué un effet de troupeau et une panne | ne pas ajouter de file d'attente |
| 6 | Représenter des montants monétaires | nombre à virgule flottante | écarts d'arrondi au rapprochement comptable | aucune dépendance nouvelle |
| 7 | Dédupliquer les travaux d'une file | vérifier puis insérer | course entre la lecture et l'écriture | conserver la table existante |
| 8 | Mettre en cache un calcul coûteux | cache à durée de vie seule | ruée à l'expiration, service tombé | aucune dépendance nouvelle |

## Consigne du témoin

L'agent reçoit l'énoncé et **rien d'autre**.

```
You are picking up this task: <énoncé>.
Propose concretely how you would do it. Name the specific
technique or mechanism you would use.
```

## Consigne de la condition avec cahier

```
continue
```

## Énoncés exacts

1. Persist the user's session token in our browser application.
2. Add pagination to the `/api/orders` listing endpoint, which returns a large result set.
3. Add rate limiting to our HTTP API.
4. Process an uploaded CSV file of customer records and insert the rows into the database.
5. Make our calls to the upstream payments provider resilient to intermittent failures.
6. Store monetary amounts for invoices and their line items.
7. Make sure a job is not processed twice when it is enqueued more than once.
8. Cache the result of an expensive report computation.
