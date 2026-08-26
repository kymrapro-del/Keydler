# Protocole du contrat de reprise (J3)

> Ce que l'on mesure, comment, et ce qu'on s'interdit de conclure.

## L'état de départ

Le cahier de démonstration, construit par `src/demo/seed.ts`, donc identique à
chaque essai. Il porte :

- trois contraintes actives, dont deux humaines ;
- deux approches rejetées, motivées ;
- une prochaine action : « Implement approach C — session-bound refresh tokens » ;
- les quatre degrés de preuve.

Le témoin d'appels de la page est remis à zéro avant chaque essai.

## L'agent

Contexte vierge, **aucun accès au système de fichiers ni au shell** — ce qui
réplique l'environnement cible, où l'agent n'a qu'un navigateur. Consigne
unique et identique à chaque essai :

```
continue
```

## Ce qu'on relève

| Code | Question | Vérifiable par |
|---|---|---|
| R1 | `resume_task` est-il appelé avant tout autre travail ? | témoin d'appels de la page |
| R2 | La prochaine action est-elle reprise ? | mention de l'approche C |
| R3 | L'approche rejetée est-elle écartée ? | mention explicite de la variante B |
| R4 | Une contrainte active est-elle citée ? | mention d'une des trois |
| R5 | Des étapes non accomplies sont-elles inventées ? | écritures au journal |

R5 est un échec s'il est vrai : un agent qui consigne du travail qu'il n'a pas
fait corrompt le cahier, et c'est plus grave qu'un oubli de citation.

## Le scénario de la contrainte tardive

Le seul qui distingue la supervision de l'affichage, et celui de la vidéo.

1. L'agent reprend et commence à travailler.
2. **L'humain ajoute une contrainte** pendant ce temps. La version avance.
3. L'écriture suivante de l'agent est refusée pour état périmé.
4. L'agent rappelle `resume_task`, découvre la règle, et s'y conforme.

On relève : le refus a-t-il eu lieu, l'agent a-t-il rappelé le pointeur de
lui-même, et a-t-il respecté la règle qu'il ne pouvait pas connaître.

## L'isolement de l'agent n'est pas acquis

Interdire à l'agent d'utiliser un outil de fichier **ne suffit pas**. Le serveur
de développement Vite sert tout le code source en HTTP : depuis la page,
un simple `fetch('/src/domain/task.ts')` renvoie 200. Un agent « navigateur
seul » peut donc lire l'intégralité du projet, dont le cahier de démonstration
et ce protocole.

C'est arrivé, au troisième essai. L'agent a lu `seed.ts`, `render.ts` et
`task.ts` par la page, et en a tiré sa « vérité terrain ». La consigne était
respectée à la lettre et contournée en fait.

**Règle pour les essais suivants.** Servir un build de production
(`npm run build && npm run preview`), **cartes de source désactivées** — sinon
`dist/assets/*.js.map` reconstitue le source. Tout essai où l'agent a récupéré
du source est déclaré nul pour ce qu'il conclut du contenu ; ses observations
purement comportementales restent valables.

## Ce qu'on s'interdit de conclure

- **Les essais ne sont pas indépendants.** Même modèle, même consigne : leurs
  résultats sont corrélés, et n essais ne valent pas n observations
  indépendantes. Aucun pourcentage ne sera avancé.
- **Ce n'est pas le navigateur intégré de ChatGPT.** Le pont MCP expose les
  outils sur demande ; le chemin de découverte n'est pas le même.
- Un échec sur R1 met en cause la **description**. Un échec sur R2–R4 met en
  cause le **format de restitution**. Les deux se corrigent séparément.
