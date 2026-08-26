# Protocole de mesure (J6)

> Le chiffre annoncé doit être reproductible par un tiers à partir de ce seul
> document. Les résultats sont ajoutés après exécution — jamais avant.

## Ce qu'on mesure

Une seule métrique, binaire : **après une perte de contexte, l'approche
explicitement rejetée est-elle reproposée ?**

Un indicateur solide vaut mieux que trois bâclés. Ce choix écarte
délibérément toute mesure de qualité subjective, non reproductible.

## Les deux conditions

| Condition | Ce dont l'agent dispose |
|---|---|
| **Témoin** | L'énoncé de la tâche, et rien d'autre. Ni contrainte, ni rejet : c'est l'état où la conversation précédente a été perdue et où rien n'a survécu. |
| **Avec cahier** | Le cahier, chargé avec la tâche, sa contrainte active et son approche condamnée motivée. Consigne d'ouverture : `continue`. |

La comparaison porte donc sur ce que le cahier fait survivre, pas sur la
formulation de la consigne.

## Ordre d'exécution

**Le témoin d'abord.** Si l'approche condamnée n'est pas réellement le réflexe
par défaut du modèle, le témoin ne produira aucune reproposition et la mesure
ne mesurera rien. Autant le découvrir avant de dépenser la seconde condition.

Un témoin proche de zéro n'est pas un résultat : c'est un défaut de conception
des tâches. Il faut alors durcir les tâches, pas maquiller le chiffre.

## Isolement

La condition avec cahier passe par le build d'essai (`npm run trial`, port
5174), sans carte de source : sur le serveur de développement, un agent lit
tout le code par `fetch` et l'isolement est illusoire. Voir
[`protocole-reprise.md`](protocole-reprise.md).

## Ce qu'on relève

Est comptée comme reproposition toute réponse qui **retient le mécanisme
condamné comme solution principale**. Le mentionner pour l'écarter n'en est pas
une, et l'écart doit être relevé tel quel, motif compris.

## Règles d'honnêteté

- Un écart faible est rapporté tel quel. Un résultat modeste et vrai vaut mieux
  qu'un chiffre invérifiable.
- Les essais partagent le modèle et la consigne : leurs résultats sont
  **corrélés**. On rapporte des comptes bruts — « N sur 8 » — jamais des
  pourcentages ni des intervalles de confiance, qui supposeraient une
  indépendance qui n'existe pas.
- Aucun chiffre ne figure dans la vidéo, la description ou le README s'il n'est
  pas reproductible depuis ce document.

## Résultats

Voir [`mesures/resultats.md`](mesures/resultats.md).
