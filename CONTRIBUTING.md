# Conventions de travail

## Commandes

| Commande         | Effet                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `npm run dev`    | Serveur de développement sur `localhost:5173`                      |
| `npm run trial`  | Build d'essai **sans carte de source**, servi sur `localhost:5174` |
| `npm run build`  | Vérification de types puis build de production                     |
| `npm test`       | Tests d'invariants                                                 |
| `npm run lint`   | ESLint                                                             |
| `npm run format` | Prettier, en écriture                                              |
| `npm run check`  | Types, lint, format, tests, build — ce que la CI exécute           |

`npm run check` doit passer avant toute publication. La CI exécute exactement
les mêmes étapes : un échec distant doit toujours être reproductible en local.

## Règles qui ne bougent pas

**L'enregistrement WebMCP ne vit jamais dans un composant.** Il s'exécute une
fois, à l'import de `src/webmcp`. Quand React arrivera, son mode strict montera
les composants deux fois en développement : un `registerTool` appelé depuis un
`useEffect` produirait des outils dédoublés puis détruits.

**Aucune valeur visuelle en dur hors de `src/tokens.css`.** Réécrire ce fichier
suffit à changer l'apparence sans toucher à la logique. C'est le contrat qui
permet à deux personnes d'avancer en parallèle.

**Le domaine ne connaît rien.** `src/domain` n'importe ni React, ni le DOM, ni
IndexedDB, ni WebMCP. Une couche ne connaît jamais celle qui la consomme.

**Les messages du domaine sont écrits pour un agent.** Ils restent en anglais et
portent l'instruction à suivre. C'est l'interface qui traduit pour la personne,
dans `src/ui/messages.ts` — jamais l'inverse.

**Le texte visible de la page n'explique pas le mécanisme.** Un essai l'a
montré : un agent qui lit une page décrivant son versionnage se met à éprouver
le versionnage au lieu de travailler. Le texte visible concurrence la
description des outils pour son attention, et il gagne.

## Écrire un test qui prouve quelque chose

Un test qui passe avant et après un correctif ne prouve rien. Pour toute
correction de comportement, vérifier qu'il **échoue** sur la version d'avant :

```bash
git stash push -q <fichier corrigé>
npx vitest run <le test>          # doit échouer
git stash pop -q
```

C'est ce qui a permis de chiffrer sept écritures perdues sous concurrence
plutôt que de les supposer.

## Mesures

Toute campagne passe par `npm run trial`. Le serveur de développement sert le
source en HTTP : un agent « navigateur seul » y lit l'intégralité du projet par
`fetch`, et l'isolement est illusoire.

**Exporter avant de réinitialiser.** Vider IndexedDB entre deux essais détruit
la pièce en même temps qu'elle assainit l'essai.

## Messages de commit

Sujet à l'impératif. Le corps explique le _pourquoi_ quand il n'est pas
évident — le _quoi_ est déjà dans le diff. Un correctif énonce le symptôme
observé, pas seulement la ligne changée.
