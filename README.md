# Cahier de quart

Mémoire de tâche persistante et supervisée, que les agents lisent et écrivent
par WebMCP.

> **État : J1.** Le dépôt ne contient volontairement qu'un banc d'essai —
> un seul outil, `resume_task`, qui rend une chaîne fixe. Tant que la reprise
> après perte de contexte n'est pas prouvée, rien d'autre ne se construit.
> Le plan complet est dans [`docs/plan-developpement.md`](docs/plan-developpement.md).

## Lancer

```bash
npm install
npm run dev
```

La page s'ouvre sur `http://localhost:5173`. Sans WebMCP, elle reste lisible et
explique quoi activer.

## Activer WebMCP

WebMCP est en essai d'origine depuis Chrome 149. En local, aucun jeton n'est
nécessaire :

1. ouvrir `chrome://flags/#enable-webmcp-testing` ;
2. passer le drapeau à **Enabled** ;
3. relancer Chrome, puis recharger la page.

Le bandeau en haut indique si l'outil est exposé. `localhost` étant un contexte
sécurisé, l'API s'enregistre sans déploiement.

Pour une origine déployée, poser le jeton dans `.env` :

```
VITE_WEBMCP_ORIGIN_TRIAL_TOKEN=votre-jeton
```

Il est injecté par script au démarrage, ce qui évite de committer dans
`index.html` un jeton lié à une seule origine.

## Le test du J1

C'est le seul test qui compte aujourd'hui. Il se déroule en deux temps.

**Premier temps — l'outil est-il découvert ?**

1. Ouvrir la page dans Chrome, drapeau activé, et vérifier le bandeau vert.
2. Depuis ChatGPT, avec l'onglet ouvert, écrire : `continue`.
3. Le compteur de la page doit s'incrémenter en direct.

**Second temps — le décisif.**

4. **Fermer la conversation.** Ne pas la résumer, ne pas la reprendre.
5. En ouvrir une vierge, onglet toujours ouvert, et écrire à nouveau :
   `continue`.

> **Critère de sortie.** Dans la conversation neuve, sans aucun historique,
> l'agent appelle `resume_task` de lui-même.

**Ce qu'il faut relever ensuite.** L'état rendu contient trois contraintes et
deux approches rejetées. Un agent qui a réellement *lu* ce qu'il a reçu :

- annonce l'approche C comme prochaine action ;
- refuse la variante B en citant la rotation des jetons ;
- n'ajoute aucune dépendance.

S'il appelle l'outil mais ignore ces éléments, le problème est dans le format de
restitution. S'il n'appelle pas l'outil, le problème est dans la description —
la reformuler sur les *circonstances* d'appel, pas sur la fonction.

## Ce que le code contient

| Fichier | Rôle |
|---|---|
| `src/webmcp/adapter.ts` | Détection d'API et enveloppes MCP. Toute l'instabilité de la spécification est enfermée ici. |
| `src/webmcp/resumeTask.ts` | L'outil, sa description et l'état figé. |
| `src/webmcp/register.ts` | Enregistrement singleton, hors de tout cycle de rendu. |
| `src/tokens.css` | Jetons visuels neutres — le seul fichier que le design réécrit. |

### Deux règles qui ne bougeront pas

**L'enregistrement ne vit jamais dans un composant.** Il s'exécute une fois, à
l'import. Quand React arrivera, son mode strict montera les composants deux
fois en développement : un `registerTool` appelé depuis un `useEffect`
produirait des outils dédoublés puis détruits.

**Aucune valeur visuelle en dur hors de `src/tokens.css`.** Réécrire ce fichier
suffit à changer l'apparence sans toucher à la logique.

### Note de compatibilité

`navigator.modelContext` est **déprécié depuis Chrome 150** : le getter a migré
vers `Document` dans le brouillon du 27 mai 2026. Le code cible
`document.modelContext` et retombe sur l'ancienne forme.

## Licence

MIT — voir [`LICENSE`](LICENSE).
