# Protocole manuel — WebMCP dans un vrai navigateur

Ce que la suite de tests couvre, elle le couvre contre un **faux
`ModelContext`** écrit d'après l'IDL de la spécification. C'est utile et c'est
insuffisant : un faux ne peut pas se tromper autrement que comme on l'a écrit.
Ce document liste ce qui doit être constaté dans un navigateur réel, et ce qu'il
faut voir exactement.

Six vérifications, une demi-heure. À rejouer après toute modification de
`src/webmcp/`.

> **Deux modes, et le mode décide de ce qu'on doit voir.** Le retrait d'un
> outil pendant la vie du document n'est sûr qu'à partir de **Chromium 153** :
> avant, avorter le contrôleur d'un outil qui répond peut emporter sa réponse.
> La page renifle la version majeure par `navigator.userAgentData` et affiche
> sa décision dans le panneau d'état.
>
> - **Chromium ≥ 153** → mode **dynamique** : les outils suivent l'état.
> - **Chromium 149–152, non-Chromium, version illisible** → mode **statique** :
>   les outils, une fois posés, le restent, et refusent proprement.
>
> **Relever le mode affiché AVANT de commencer**, et suivre la colonne
> correspondante. Un mode inattendu invalide les vérifications 3 et 4.

---

## Préparation

```bash
npm run trial
```

Le build d'essai est **obligatoire** : le serveur de développement sert tout le
source en HTTP, et un agent « navigateur seul » lit alors l'intégralité du
projet par `fetch`. Un essai fait sur `npm run dev` est nul.

```bash
brave --remote-debugging-port=9222 \
  --user-data-dir=/tmp/brave-webmcp \
  --enable-features=WebMCP,WebMCPTesting \
  http://localhost:5174
```

Passer les deux drapeaux : la fonctionnalité s'appelle `WebMCPTesting` dans
Brave 151, alors que l'aide de `chrome-devtools-mcp` annonce `WebMCP`. Le
basculement dans `brave://inspect/#remote-debugging` **n'ouvre aucun port**, et
Chromium ≥ 136 **refuse** le débogage distant sur le profil par défaut.

```bash
claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest \
  --browserUrl http://127.0.0.1:9222 --categoryExperimentalWebmcp
```

Repartir d'un cahier vide : bouton **Supprimer ce cahier** jusqu'à l'état vide,
ou profil neuf.

> **Ce que `getTools()` prouve et ne prouve pas.** La ligne « Outils
> enregistrés, relus par `getTools()` » du panneau lit la table du navigateur.
> C'est une seconde source, distincte de ce que la page croit avoir posé — donc
> utile. Ce n'est **pas** une preuve que l'agent intégré voit ces outils : la
> spécification réserve `getTools()` aux agents qui vivent dans la page, et
> l'agent du navigateur passe par un mécanisme interne. Les vérifications 1 et 2
> ci-dessous doivent donc être faites **depuis le client MCP**, pas depuis la
> console.

---

## 1. Page sans tâche : deux outils

État : aucun cahier ouvert.

Depuis le client MCP, lister les outils de la page.

- [ ] **Exactement deux** : `resume_task`, `read_task_detail`.
- [ ] Aucun outil d'écriture n'apparaît.
- [ ] `resume_task` rend `NO ACTIVE TASK`.

> Un outil d'écriture exposé ici ne pourrait que refuser. Il allongerait la
> liste que l'agent doit lire pour choisir, sans jamais pouvoir aboutir.

## 2. Tâche active : sept outils

Ouvrir un cahier (bouton **Ouvrir un cahier de démonstration**, ou `?mesure=1`).

- [ ] La liste passe à **sept** sans rechargement de la page. _(Vrai dans les
      deux modes : POSER un outil n'avorte rien, seul le retrait est risqué.)_
- [ ] Les cinq écritures sont présentes : `log_step`, `add_constraint`,
      `reject_approach`, `add_decision`, `complete_task`.
- [ ] `resume_task` rend un `TASK ID` et une `URL` en `/t/:id`, et l'adresse de
      la barre correspond.

> C'est ici que se voit ce qu'un faux ne peut pas garantir : que le client MCP
> **rafraîchit réellement** sa liste sur `toolchange`. Si les sept outils
> n'apparaissent qu'après un rechargement, le cycle de vie dynamique n'a
> d'existence que dans la page.

## 3. `complete_task` rend sa réponse

Demander à l'agent de clore la tâche.

- [ ] L'agent **reçoit** la réponse : `OK — complete_task recorded.` avec la
      nouvelle version. Pas d'erreur, pas de silence, pas de délai d'attente.
- [ ] `resume_task` rend `TASK CLOSED`.

Puis, selon le mode relevé :

- **statique** — [ ] la liste reste à **sept** ; un `log_step` refuse avec
  `task … is already completed` et l'invitation à faire rouvrir par l'humain.
- **dynamique** — [ ] la liste retombe à **deux** outils.

> **La vérification la plus importante du lot.** C'est le déroulé où le produit
> peut perdre une réponse : l'écriture de `complete_task` provoque son propre
> retrait.
>
> Une version antérieure du code retenait le retrait d'un tour de boucle, par
> `setTimeout`, en supposant la réponse livrée entre-temps. La spécification dit
> le contraire : **l'ordre entre la source de tâches WebMCP et celle des
> minuteurs ne peut pas être invoqué**. Un tour de boucle n'est pas une
> garantie de livraison. Le mode statique supprime le risque à la racine — on
> ne casse pas une exécution avec un contrôleur qu'on n'avorte jamais.
>
> Noter la version exacte du navigateur sur cette ligne : c'est la seule
> mesure qui dise quelque chose du comportement réel de Chrome 149–152.

## 4. Réouverture : les écritures fonctionnent de nouveau

Cliquer **Rouvrir la tâche**, donner un motif.

- [ ] `log_step` aboutit de nouveau, avec la version rendue par `resume_task`.
- **dynamique** — [ ] la liste remonte à **sept** sans rechargement.
- **statique** — [ ] la liste est restée à sept ; rien ne bouge, et c'est
  attendu.

## 5. Annulation pendant une file d'attente

Lancer deux écritures d'agent rapprochées, puis interrompre la seconde
(bouton « stop » du client, ou `Esc`) pendant qu'elle attend son tour.

- [ ] **Aucune mutation** n'est créée par l'appel interrompu : le compteur
      d'étapes n'augmente que d'une.
- [ ] La **version n'avance que d'un** cran.
- [ ] Le refus est **audité** : dans « Journal des écritures » de l'export, une
      ligne `log_step` marquée `refusé`, de motif « cancelled before anything
      was written », sans changement de version.
- [ ] Le compteur d'appels de la page montre l'appel refusé.

> Un appel annulé qui écrirait quand même produirait une écriture que personne
> ne voit passer : l'agent ne reçoit rien, réessaie, et le cahier compte deux
> fois le même travail.

## 6. Rejeu exact après perte simulée de réponse

Faire consigner une étape par l'agent, en notant son `mutation_id`. Puis, depuis
le client MCP, **rappeler `log_step` avec exactement les mêmes arguments**,
`mutation_id` compris.

- [ ] La réponse est **identique** à la première, suivie de la mention
      « Replay of an earlier call with this mutation_id. Nothing was written
      twice. »
- [ ] Le nombre d'étapes **n'a pas changé**.
- [ ] La version **n'a pas changé**.

Puis rappeler `log_step` avec le **même `mutation_id`** et une `action`
différente.

- [ ] L'appel est **refusé**, message contenant `different arguments`.
- [ ] Rien n'est écrit, et surtout **aucun `OK`** n'est rendu : un agent qui
      croit son travail consigné ne le reconsigne pas.
- [ ] Le refus est **audité** : ligne `log_step` … `refusé`, motif
      `mutation_id: mutation-id-collision`.

---

## Fiche de relevé

| #   | Vérification                                 | Navigateur / version | Mode relevé | Résultat | Notes |
| --- | -------------------------------------------- | -------------------- | ----------- | -------- | ----- |
| 0   | Mode affiché dans le panneau d'état          |                      |             |          |       |
| 1   | 2 outils sans tâche                          |                      |             |          |       |
| 2   | 7 outils sur tâche active, sans rechargement |                      |             |          |       |
| 3   | `complete_task` rend bien sa réponse         |                      |             |          |       |
| 4   | Réouverture : écritures fonctionnelles       |                      |             |          |       |
| 5   | Annulation : aucune mutation, refus audité   |                      |             |          |       |
| 6   | Rejeu exact / collision d'arguments          |                      |             |          |       |

Reporter les relevés dans `docs/verification.md`, avec la version exacte du
navigateur. **Un point non relevé se note « non vérifié », jamais « supposé
bon ».**
