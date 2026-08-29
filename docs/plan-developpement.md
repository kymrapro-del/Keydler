# Plan de développement — Nightorder

> Échéance : **3 septembre 2026, 13 h PDT** (22 h Paris).
> Cible de dépôt : **2 septembre au soir**. Le 3 n'est qu'un filet.
> Dépôt remis à zéro le 26 août.

---

## 1. La répartition

C'est le seul point à verrouiller avant d'écrire une ligne. Tant qu'il est
flou, chaque tâche risque de tomber entre les deux.

| Voie              | Qui   | Contenu                                                                                               |
| ----------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| **Design**        | Kymra | Charte, couleurs, typographie, formes, apparence de chaque écran                                      |
| **Network**       | Kymra | Hébergement, URL publique, dépôt public, description de soumission, dépôt de la candidature           |
| **Tout le reste** | Moon  | Architecture, domaine, WebMCP, persistance, **code de l'interface**, tests, CI, documentation, mesure |

Autrement dit : le _comportement_ de l'interface est dans la voie de Moon, son
_apparence_ dans celle de Kymra. Un écran existe, s'affiche et réagit parce que
Moon l'a codé ; il est beau parce que Kymra l'a habillé.

**La vidéo est une vidéo de présentation**, produite à la fin. Elle explique ce
qui a été construit et l'usage fait de WebMCP ; elle ne dépend donc pas d'un
refus d'écriture capté en direct. Décidé le 26 août.

---

## 2. Le contrat entre les deux voies

Pour que Kymra puisse travailler sans jamais toucher à la logique, et Moon sans
jamais attendre la charte :

- **Aucune valeur visuelle en dur dans un composant.** Couleur, espacement,
  typographie, rayon, ombre : tout passe par des variables CSS déclarées dans un
  seul fichier de jetons.
- **Moon livre ce fichier avec des valeurs neutres**, lisibles et accessibles,
  mais sans prétention esthétique. C'est un point de départ, pas une
  proposition de design.
- **Kymra réécrit ce fichier**, et rien d'autre. Le reste du code ne bouge pas,
  les tests continuent de passer.
- **Le balisage est sémantique** — titres, listes, formulaires, régions — pour
  que restyler ne demande jamais de restructurer.

Ce contrat est ce qui permet aux deux voies d'avancer en parallèle au lieu de
se bloquer l'une l'autre.

---

## 3. Périmètre technique proposé

> À confirmer avant le J2. Ce périmètre est celui qui rend la démonstration
> possible ; le réduire davantage retire un pilier.

- **Six outils WebMCP** : `resume_task`, `log_step`, `add_constraint`,
  `reject_approach`, `add_decision`, `complete_task`.
- **État versionné** : toute mutation appliquée incrémente la version.
- **Refus d'écriture périmée** : toute écriture d'agent porte la version sur
  laquelle il croit travailler ; une divergence est refusée, jamais fusionnée.
- **Écriture humaine autoritaire** : sans version, jamais refusée. C'est elle
  qui périme celle de l'agent — toute la supervision tient dans cette asymétrie.
- **Persistance locale** IndexedDB. Ni compte, ni serveur : cela supprime
  l'authentification et rend la démonstration reproductible immédiatement.
- **Degrés de preuve** distinguant travail prouvé et travail affirmé.

### Correction technique par rapport au plan initial

`navigator.modelContext` est **déprécié depuis Chrome 150** : la spécification a
déplacé le getter vers `Document` dans le brouillon du 27 mai 2026. Le code doit
cibler `document.modelContext` avec repli sur l'ancienne forme, et cette
instabilité doit rester enfermée dans un seul adaptateur.

### Les quatre choses qui ne se coupent jamais

Le pointeur permanent et sa reprise · le versionnage avec refus d'écriture
périmée · l'ajout humain d'une contrainte en direct · la distinction visuelle
entre travail prouvé et affirmé.

Tout le reste est décor. Les deux dernières demandent une interface : leur
_comportement_ est dans la voie de Moon, leur _apparence_ dans celle de Kymra.

---

## 4. Calendrier

Chaque journée porte un critère de sortie vérifiable. Une journée sans critère
atteint se rattrape le soir même, pas le lendemain.

### J1 — 26 août · **VERROU**

Prouver la reprise, et rien d'autre. Aucune interface, aucun style, aucun
modèle de données définitif.

- Projet Vite + TypeScript nu.
- Un seul outil `resume_task` renvoyant une chaîne fixe, enregistré au
  chargement dans un module singleton — **jamais depuis un `useEffect`**.
- Détection de l'absence de `document.modelContext` avec message d'aide.

Le critère se scinde en deux tests distincts, qu'il ne faut pas confondre.

**Test A — l'enregistrement.** Chrome avec `chrome://flags/#enable-webmcp-testing`,
puis DevTools → onglet **Application** → section **WebMCP**. Les outils
enregistrés y apparaissent et s'invoquent à la main. Aucun agent nécessaire,
aucun déploiement : `localhost` est un contexte sécurisé.

**Test B — la découverte par un agent.** Un pont MCP
(`@mcp-b/chrome-devtools-mcp`) expose les outils de la page à un client MCP —
Claude Code ou Codex CLI, tous deux exécutables sous Linux. Conversation neuve,
onglet ouvert, consigne « continue ».

> **Critère de sortie.** Test A passé, et dans une conversation neuve sans
> historique, l'agent va chercher les outils de la page et appelle `resume_task`.
> Si le Test A échoue, le code est en cause. Si seul le Test B échoue, c'est la
> description : la reprendre jusqu'à ce que ça marche.

**Ce que le Test B n'est pas.** Via le pont, l'agent voit deux outils
génériques — `list_webmcp_tools` et `call_webmcp_tool` — et non les outils de la
page directement. C'est un chemin de découverte différent de celui du navigateur
intégré de ChatGPT. Réel, mais différent : à ne pas présenter pour autre chose
qu'il n'est.

**Contrainte de poste.** ChatGPT desktop n'existe pas sous Linux. Ce n'est pas
bloquant : les règles du concours demandent une URL accessible « via le
navigateur intégré de ChatGPT **ou** Google Chrome avec WebMCP activé », et
n'imposent aucun client IA pour la démonstration.

### J2 — 27 août · Le noyau

Modèle de domaine, magasin IndexedDB, six outils. Vérification par le panneau
WebMCP des outils de développement, pas par une interface.

- Types figés, incrément de version sur chaque mutation sans exception.
- Refus d'écriture sur version divergente, message explicite renvoyant vers
  `resume_task`.
- Identifiant de tâche dans l'URL, état rechargé au montage.
- Tests d'invariants et CI en place.

> **Critère de sortie.** Les six outils invoqués à la main produisent un état
> cohérent qui survit à un rechargement. Un appel volontairement périmé est
> refusé.

### J3 — 28 août · Le contrat de reprise

La journée la plus sous-estimée : il ne s'agit plus de code mais de
formulation.

- Format de restitution calibré sous 400 tokens, contraintes et rejets jamais
  tronqués.
- Descriptions des six outils itérées contre un agent réel.
- Scénario de bout en bout : lancer, couper, reprendre, vérifier.

> **Critère de sortie.** Sur une tâche réelle, conversation fermée puis
> rouverte : l'agent cite spontanément une contrainte et refuse une approche
> rejetée. C'est le scénario de la vidéo — reproductible avant qu'on filme.

### J4 — 29 août · Interface, comportement

Rendre visible ce qui existe. Balisage sémantique, câblage au magasin, états
vides, chargement et erreur. Valeurs visuelles neutres, toutes en variables.

- Bandeau d'état, chronologie, panneaux, compteurs de preuve.
- Mise à jour immédiate à chaque appel d'outil, sans rechargement.
- **Livraison du fichier de jetons à Kymra**, avec la liste de ce qu'elle
  contrôle.

> **Critère de sortie.** Un observateur comprend l'état de la tâche sans
> explication. Et Kymra peut commencer.

### J5 — 30 août · Supervision humaine

Le moment où le produit cesse d'afficher pour superviser.

- Ajout d'une contrainte à la main, marquée `human`, qui incrémente la version.
- Validation d'une preuve d'un clic.
- Désactivation d'une contrainte, rejet manuel d'une approche.
- Signal visible quand une écriture d'agent est refusée pour état périmé.

> **Critère de sortie.** Séquence filmable : taper une contrainte pendant que
> l'agent réfléchit, voir l'écriture suivante refusée, puis l'agent rappeler le
> pointeur et respecter la nouvelle règle.

### J6 — 31 août · La mesure

Périmètre volontairement resserré : **huit tâches, une seule métrique**.

- Chaque tâche a une contrainte explicite et une approche condamnée.
- Condition témoin sans cahier, condition avec cahier, mêmes tâches, même
  consigne d'ouverture.
- Métrique unique et binaire : l'approche rejetée est-elle reproposée ?
- Protocole et journaux versés au dépôt.

> **Critère de sortie.** Une phrase chiffrée, vraie et reproductible. Si l'écart
> est faible, le dire quand même : un résultat honnête et modeste vaut mieux
> qu'un chiffre invérifiable. Quatre tâches au minimum, jamais zéro.

### J7 — 1er septembre · Intégration et dossier

- Reprise des jetons de Kymra, vérification que rien n'a cassé.
- README : architecture, lancement local, comportement sans WebMCP, scénario de
  démonstration, protocole de mesure.
- Accessibilité clavier, contrastes, mise en page étroite.

> **Critère de sortie.** Le dépôt est lisible par quelqu'un qui n'a jamais vu le
> projet, et `npm run check` passe.

### J8 — 2 septembre · **MARGE**

Journée volontairement sous-chargée : elle absorbe les retards des sept
précédentes.

- Parcours complet sur une machine vierge, en navigation privée.
- Vérification de la page sans WebMCP actif.
- États vides soignés.

> **Critère de sortie.** Tout ce qui relève de la voie technique est prêt et
> vérifié. Le dépôt de la candidature revient à Kymra.

---

## 5. Ce qu'il faut de Kymra, et quand

Ces dates sont des butoirs, pas des souhaits. Chacune bloque une journée entière
si elle glisse.

| Quoi                      | Butoir        | Bloque                                |
| ------------------------- | ------------- | ------------------------------------- |
| URL HTTPS déployée        | 31 août       | La recevabilité, et le test des juges |
| Dépôt basculé en public   | 1er septembre | La recevabilité de la soumission      |
| Jetons de design          | **31 août**   | L'intégration du J7                   |
| Vidéo                     | 1er septembre | La recevabilité                       |
| Description de soumission | 2 septembre   | La recevabilité                       |

Le dépôt est **privé** à ce jour, alors que le concours exige un dépôt public.
C'est le point le plus simple à régler et le plus coûteux à oublier.

---

## 6. Les coupes, dans l'ordre

Décidées à froid maintenant pour ne pas les improviser le 1er septembre. On
coupe d'abord ce qui ne se voit pas à l'écran, et jamais le mécanisme central.

1. **L'export du cahier** — utile en vrai, invisible en démonstration.
2. **Le degré `machine_verified`** — trois degrés au lieu de quatre.
3. **Les décisions et leur justification** — le triptyque contraintes / rejets /
   étapes suffit ; `add_decision` peut disparaître.
4. **La mesure ramenée à quatre tâches** — jamais supprimée entièrement.
5. **Le multi-tâches** — un seul cahier actif, identifiant fixe.

---

## 7. Ce qui peut faire échouer le chantier

### L'agent n'appelle pas le pointeur spontanément

Le risque principal, et il se manifeste dès ce soir. La cause est presque
toujours la description : trop descriptive, pas assez prescriptive. Faire porter
la formulation sur les circonstances d'appel plutôt que sur la fonction.

### La répartition laisse un trou

Deux des quatre piliers demandent une interface. Si « design » est compris
comme « toute l'interface », personne ne code leur comportement et le projet
perd la moitié de sa démonstration. Le contrat de la section 2 existe pour
éviter exactement ça.

### La mesure ne montre pas d'écart

Possible si les tâches sont trop courtes pour que l'agent dérive. Rallonger les
tâches et durcir les contraintes, jamais maquiller le résultat. Un chiffre
gonflé découvert par un juge élimine.

### Le déploiement arrive trop tard

Trois livrables sur quatre dépendent d'une URL en ligne. Si elle n'existe qu'au
1er septembre, il ne reste aucune marge pour découvrir qu'elle ne marche pas.
Le développement, lui, ne l'attend pas : tout se teste sur `localhost`.

### On confond enregistrement et découverte

Le panneau DevTools prouve que les outils existent, pas qu'un agent les appelle
de lui-même. Valider le J1 sur le seul Test A donnerait une fausse assurance et
ferait découvrir le vrai problème le 1er septembre.

---

## 8. Contrôle avant dépôt

- [ ] L'URL s'ouvre en HTTPS et fonctionne en navigation privée, sans compte
- [ ] Une conversation neuve découvre les outils et reprend la tâche
- [ ] Le dépôt est public, porte une licence MIT et un README exploitable
- [ ] La vidéo dure moins de trois minutes, est publique, avec audio
- [ ] La description explique quel usage de WebMCP est fait, et pourquoi il est nécessaire
- [ ] Le protocole de mesure et ses journaux sont au dépôt, reproductibles
- [ ] Aucun chiffre invérifiable nulle part — ni vidéo, ni description, ni README
