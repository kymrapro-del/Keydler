# Échelle et coût, 28 août 2026

Les deux audits précédents cherchaient des défauts de correction. Celui-ci
cherche des défauts de coût : ce qui grandit sans borne, ce qui se refait
inutilement, ce qui cesse d'être utilisable quand le cahier se remplit.

Tout ce qui suit est mesuré. Le banc est dans le dépôt :

```bash
npm run bench
```

**Ce que vaut cette mesure.** Le banc tourne sous jsdom et fake-indexeddb,
comme la suite de tests. Les durées de rendu y sont donc pessimistes :
l'analyseur HTML de jsdom est bien plus lent que celui d'un navigateur, et il
ne fait ni style ni mise en page. Se transportent tels quels : les tailles de
HTML, les nombres de nœuds, les comptes de tokens, et les durées des fonctions
pures. Elles tournent sur le même V8 ici et dans Chrome.

La colonne « avant » n'est pas un souvenir : elle vient du même banc relancé
sur `src` restauré à `28cf6cc`, le commit qui précède ces correctifs.

---

## 1. `resume_task` dépassait son propre budget d'un facteur 94

**Gravité : élevée.** C'est la promesse centrale du produit : une restitution
bornée, qui tient dans le contexte d'un agent. `TOKEN_BUDGET` vaut 400.

| Règles actives | Avant         | Après |
| -------------- | ------------- | ----- |
| 0              | 390           | 390   |
| 10             | 487           | 487   |
| 100            | 2 174         | 553   |
| 1 000          | 19 050        | 554   |
| 2 000          | 37 800 tokens | 554   |

Les approches écartées faisaient pire : 45 247 tokens à 2000.

L'échelle de dégradation ne pouvait rien y faire. Elle coupait les étapes, les
décisions, les propositions, les réponses, les autorisations, les
contestations, mais jamais les obligations, par choix délibéré : une règle
engage, on ne la retire pas.

**Pourquoi ce choix était le mauvais.** Une restitution de 37 800 tokens n'est
pas lue : elle est tronquée par la fenêtre de contexte du modèle, en silence et
hors de notre portée. Le choix n'était donc pas « tout garder ou couper », mais
« couper ici en le disant, ou laisser couper ailleurs sans que personne le
sache ». Le produit entier plaide pour la première option.

**Correctif.** Les règles et les approches écartées cèdent en dernier,
jamais sous un plancher de douze, et jamais en silence :

```
CONSTRAINTS: binding (2000)
  [human] Never touch shard 0 without taking a snapshot…
  …
  1988 more not shown here. THEY ARE STILL BINDING.
  Read them with read_task_detail on constraints before you act.
```

La coupe se fait par le début, et non par la fin : une fenêtre glissante
ferait disparaître une règle qu'un agent avait déjà lue, sans que rien n'ait
changé pour elle.

À dix règles, 487 tokens : le plancher passe avant le budget, et c'est assumé.
Le budget est une cible, pas une garantie, et il l'était déjà avant.

---

## 2. Quatre listes du tableau de bord ne s'arrêtaient jamais

**Gravité : élevée.** Les étapes étaient bornées depuis longtemps
(`MAX_ROWS = 8`). Les règles, les approches écartées, les questions et les
autorisations ne l'étaient pas. Or la page se redessine entièrement à
chaque frappe dans la recherche.

À 2000 entrées, un aller-retour de rendu :

| Liste           | HTML avant | Nœuds avant | Durée avant | HTML après | Nœuds après | Durée après |
| --------------- | ---------- | ----------- | ----------- | ---------- | ----------- | ----------- |
| Règles          | 1,45 Mo    | 10 354      | 559 ms      | 55 ko      | 416         | 25 ms       |
| Écartées        | 1,15 Mo    | 12 347      | 560 ms      | 54 ko      | 420         | 31 ms       |
| Questions       | 1,04 Mo    | 14 376      | 581 ms      | 54 ko      | 433         | 1,3 ms      |
| Autorisations   | 1,30 Mo    | 16 377      | 732 ms      | 55 ko      | 442         | 1,7 ms      |
| Étapes (témoin) | 59 ko      | 448         | 19 ms       | 59 ko      | 448         | 4,1 ms      |

Les nœuds sont désormais plats : 416 contre 404 à dix règles.

**Correctif.** Un seul rendu borné, partagé par les quatre listes, avec un
bouton qui ouvre la liste entière. Et, pour les règles, une phrase quand ce qui
est hors de vue engage encore :

> 28 rules still in force are not shown. Open the full list before you rely on
> this one.

**Deux autres, trouvées en relisant la même faute.** Le sélecteur de cahiers
affichait une ligne par cahier du poste, et chaque ligne fait balayer les
étapes de son cahier par `needsYou` pour sa pastille, si bien que la page
coûtait le poste entier et pas seulement le cahier ouvert. La liste des
identifiants scellés n'était pas bornée non plus. Les deux passent par le même
rendu borné. Le test de garde a été élargi à cette dimension : il faisait varier
le contenu d'un cahier, pas le nombre de cahiers, et n'aurait rien vu.

**Un ordre qu'on a essayé puis retiré.** Faire passer les règles en vigueur
devant les règles levées garantissait qu'une troncature ne cache jamais une
obligation. Mais lever une règle la faisait alors sauter au bas de la liste,
sous le curseur de celui qui venait de cliquer. L'ordre de pose est conservé,
et c'est le compte des obligations hors cadre qui porte la garantie.

---

## 3. La recherche repliait les accents 60 000 fois par frappe

`searchTask` relit tout le cahier à chaque caractère tapé. Le repli (`toLower`,
`normalize('NFD')`, `\p{Diacritic}`) s'appliquait à chaque champ et à la
requête, à chaque comparaison.

| Sur 20 000 étapes    | Avant    | Après   |
| -------------------- | -------- | ------- |
| Mot absent du cahier | 21,50 ms | 5,05 ms |
| Mot très fréquent    | 21,40 ms | 9,37 ms |

Deux changements : la requête est repliée une fois, et une chaîne ASCII
(une sortie de commande, un diff, une URL, une empreinte) saute le repli, qui
n'aurait rien à y faire.

**Ce que ça coûte.** Sur un texte entièrement accentué, le test ASCII échoue à
chaque fois et l'on paie 13 % de plus. C'est le sens de l'échange, et il penche
du bon côté pour ce que ce produit contient.

Le mot fréquent reste plus cher que le mot absent : il construit des milliers
d'objets `Match`. On ne s'arrête pas au douzième volontairement : l'en-tête
annonce `12 shown of 4211 found`, et ce total est une information utile
(« resserrez la requête »), pas un détail d'implémentation.

---

## 4. La garde anti-répétition repliait tout, à chaque comparaison

Ajouter une règle demande « est-ce déjà posé, au mot près ? », donc un balayage
de tout ce qui est posé. Chaque comparaison repliait les deux côtés.

| Règles déjà posées | Avant    | Après    |
| ------------------ | -------- | -------- |
| 500                | 0,238 ms | 0,080 ms |
| 1 000              | 0,704 ms | 0,224 ms |
| 2 000              | 1,636 ms | 0,541 ms |

Le balayage reste linéaire (c'est la question posée), mais la nouveauté n'est
repliée qu'une fois, et le repli profite de la voie rapide ASCII.

La recherche et la garde partagent désormais une seule définition de « le
même mot, à la casse et aux accents près ». Deux endroits qui répondaient
différemment à cette question finissaient par se contredire devant
l'utilisateur.

---

## 5. Trois rendus sur dix ne changeaient rien à l'écran

Le rendu est réveillé par le magasin, par les appels d'outil et par les
enregistrements d'outils. Beaucoup de ces réveils ne changent rien.

Compté sur la suite d'interface : 30 rendus sur 100 produisaient un HTML
identique au précédent, et payaient quand même la reconstruction du DOM, le
rattachement de tous les écouteurs et la restitution du focus.

La page compare désormais le HTML produit à celui qui est affiché. Le piège
était de se souvenir du HTML sans remarquer que la racine, elle, avait été
remplacée : un test tient ce cas, parce que la conséquence est une page blanche.

---

## 6. Le contrôle de concurrence relisait tout le cahier pour un entier

**Gravité : moyenne, mais c'est le cœur.** Deux pages ouvertes ne doivent pas
pouvoir s'écraser : avant d'écrire, on vérifie que le cahier est bien à la
version sur laquelle on s'est basé. La vérification portait sur un entier, et
l'obtenait en rapatriant le cahier entier.

Mesuré dans Chrome, sur un cahier de 798 ko :

| Opération                                  | Durée  |
| ------------------------------------------ | ------ |
| Relire l'enregistrement complet (l'ancien) | 2,0 ms |
| Interroger une clé d'index                 | 0,1 ms |

C'était plus de la moitié du coût d'une écriture. Sous jsdom, `saveTask` à
4000 étapes : 8,31 ms avec contrôle, 3,99 ms sans.

**Correctif.** Un index composé sur `['id', 'version']` répond « ce cahier
est-il à CETTE version ? » sans rapatrier son contenu. Il est tenu par
IndexedDB à partir des champs du cahier lui-même : contrairement à un compteur
recopié ailleurs, rien ne peut dériver de ce qu'il garde. Le chemin du
conflit relit l'enregistrement (il faut bien dire sur quelle version se
rebaser), et lui seul paie.

`saveTask` à 4000 étapes : 8,31 ms → 3,95 ms, soit ce que coûte une
écriture sans aucun contrôle.

`DB_VERSION` passe de 2 à 3. Un test ouvre la base à l'ancienne version
avant que quoi que ce soit d'autre n'y touche, y écrit un cahier, puis vérifie
que la migration construit l'index par-dessus : c'est la migration qui ferait
perdre les données de vraies personnes. Vérifié dans Chrome également : un
cahier de 798 ko a survécu à la montée, et les deux index sont là.

---

## 7. Le sélecteur gardait tout le poste en mémoire

Pour dessiner une liste déroulante repliée, la page gardait chaque cahier du
poste en entier, en permanence.

| 20 cahiers × 2000 étapes | Retenu  |
| ------------------------ | ------- |
| Cahiers entiers (avant)  | 15,9 Mo |
| Fiches (après)           | 6,3 ko  |

La fiche porte ce que le sélecteur affiche, plus la pastille « needs you »
calculée avant que le cahier ne soit relâché. Elle est calculée à partir du
cahier normalisé, jamais de l'enregistrement brut : une seconde lecture
défensive, plus rapide mais distincte, finirait par répondre autre chose que la
première.

Le coût de lecture ne bouge pas : c'est la mémoire retenue qui est
bornée. La mesure est la taille sérialisée de ce qui reste accroché, un
mandataire déterministe, là où le tas d'un worker est trop bruyant pour
trancher.

---

## 8. Le démarrage rapatriait tous les cahiers quand il n'en cherchait qu'un

Sans `lastTaskId` (après un import, ou sur une base neuve), le démarrage lisait
tous les cahiers du poste pour n'en garder qu'un. L'index par date
d'écriture est déjà trié : on n'a besoin que de ses clés, et l'on ne descend au
suivant que si le plus récent est illisible, exactement comme avant.

| 30 cahiers × 500 étapes     | Avant   | Après  |
| --------------------------- | ------- | ------ |
| Démarrage sans `lastTaskId` | 22,0 ms | 0,8 ms |

Le démarrage ne dépend plus du nombre de cahiers sur le poste.

---

## 9. Ce que lit l'agent était recalculé à chaque frappe

Le panneau technique montre exactement ce que `resume_task` rendrait. Ce texte
coûte environ 5 ms sur un cahier de 20 000 étapes, et il était reconstruit à
chaque rendu, donc à chaque caractère tapé dans la recherche, pour un panneau
replié la plupart du temps.

Le cahier est immuable et remplacé en entier à chaque écriture : comparer les
identités suffit. La minute entre dans la clé parce que la restitution porte une
ligne qui dépend de l'heure (« LAST WRITE … ») ; sans elle, l'aperçu finirait
par mentir sur l'âge du cahier.

Rendu interactif sur 20 000 étapes (le cahier ne bouge pas, l'écran si) :
27,7 ms → 25,6 ms. Modeste, et c'est le chiffre réel, pas les 5 ms qu'on
pouvait espérer.

Sur un cahier chargé en règles, c'est tout autre chose, et je ne l'avais pas
vu en écrivant le paragraphe ci-dessus. La restitution passe alors par l'échelle
de dégradation, qui la reconstruit une demi-douzaine de fois pour tenir dans le
budget, et cela recommençait à chaque rendu de la page :

| Rendu au repos, 2000 entrées | Avant   | Après  |
| ---------------------------- | ------- | ------ |
| Règles                       | 26,3 ms | 0,9 ms |
| Approches écartées           | 30,9 ms | 0,7 ms |

Le correctif de la section 1 avait donc déplacé le coût plutôt que de le
supprimer : la restitution était bornée, mais on la payait à chaque battement de
la page. Les deux ensemble tiennent.

Dans la même veine : l'historique décrivait ses 200 entrées pour en montrer
douze.

---

## Mesuré, et laissé tel quel

### L'écriture réécrit le document entier

Chaque mutation sérialise et réécrit tout le cahier. Le coût suit donc sa
taille :

| Cahier au départ                 | Par écriture | Débit       |
| -------------------------------- | ------------ | ----------- |
| Vide                             | 0,10 ms      | ~10 000 / s |
| 2000 étapes dont 667 avec preuve | 13 ms        | ~80 / s     |

Inchangé par ce travail. Le correctif structurel (découper le document en
plusieurs enregistrements) demanderait une montée de schéma et une migration,
pour un scénario où quatre-vingts écritures par seconde restent très au-delà de
ce qu'un agent produit. Le coût marginal d'une étape, lui, est plat : 0,008 ms
à mille étapes comme à quatre mille.

### Le sélecteur relit tous les cahiers en entier

`listTasks` normalise chaque cahier du poste pour afficher une liste déroulante
repliée : 20 cahiers de 5000 étapes coûtent 153 ms. Rester à un seul chemin de
normalisation vaut mieux qu'un second, plus rapide et qui dériverait ; et
20 cahiers de 200 étapes (la taille réelle) coûtent 5 ms.

### Le rendu par sections

L'idée : ne remplacer que les cartes qui ont changé, au lieu de reconstruire la
page. Mesuré dans Chrome avant de s'y lancer : réécrire les 58 ko de HTML
d'une page complète coûte 0,7 ms. jsdom donnait 15 ms pour le même travail,
vingt fois trop.

Le gain plafonnait donc sous la milliseconde, contre une refonte des 2900 lignes
du tableau de bord et le passage obligé par la délégation d'événements. Non
fait. Un rendu qui change vraiment coûte 5,8 ms dans Chrome sur un cahier de
798 ko, et une frappe dans la recherche 6,9 ms, sous la barre d'une image.

C'est la mesure qui a tranché, et elle a tranché contre.

### Le paquet

173 ko bruts, 51 ko gzip pour le JavaScript, 3 ko pour le CSS, zéro
dépendance de production hors `idb`. Découper en morceaux chargés à la demande
gagnerait quelques kilo-octets et ajouterait des modes de panne à un produit qui
doit fonctionner hors ligne. Non fait, délibérément.

---

## Ce que ces correctifs coûtent

Une optimisation qui ne coûte rien n'a en général rien changé.

| Poste                                       | Avant      | Après               |
| ------------------------------------------- | ---------- | ------------------- |
| `renderTaskState`, 20 000 étapes            | 3,73 ms    | 4,24 ms             |
| Recherche sur un texte entièrement accentué | sans objet | +13 %               |
| Une entrée d'index de plus par écriture     | sans objet | tenue par IndexedDB |

Le premier vient de l'échelle de dégradation, qui compte un barreau de plus :
un rendu complet supplémentaire quand le budget est dépassé. Un cahier ordinaire
n'y arrive jamais.

---

## Tests de mutation

Quarante garanties cassées une par une ; la suite doit rougir à chaque fois.

| Garantie cassée                                          | Suite |
| -------------------------------------------------------- | ----- |
| Les règles ne sont plus bornées dans la restitution      | rouge |
| L'avertissement « toujours engageant » disparaît         | rouge |
| Les rejets ne sont plus bornés                           | rouge |
| Le compte des rejets cachés est tu                       | rouge |
| Le plancher d'obligations tombe à zéro                   | rouge |
| La coupe se fait par la fin plutôt que par le début      | rouge |
| `capped` ignore la limite                                | rouge |
| Le bouton « Show all » disparaît                         | rouge |
| L'avertissement sur les obligations cachées disparaît    | rouge |
| Le compte d'obligations cachées inclut les règles levées | rouge |
| Les étapes ne sont plus bornées                          | rouge |
| Les questions ne sont plus bornées                       | rouge |
| Le sélecteur de cahiers redevient sans borne             | rouge |
| Le bouton du sélecteur disparaît                         | rouge |
| Le saut de rendu est retiré                              | rouge |
| On saute le rendu même quand le HTML change              | rouge |
| Le HTML peint n'est pas oublié au montage                | rouge |
| Le repli des accents est sauté toujours                  | rouge |
| La garde ne replie plus rien                             | rouge |
| La garde ne compare plus la nouveauté                    | rouge |
| La voie rapide ASCII avale tout                          | rouge |
| La requête n'est plus repliée                            | rouge |
| L'élagage du journal est tu à l'appelant                 | rouge |
| Le bouton d'histoire est caché quand tout est élagué     | rouge |
| Le contrôle de version ne refuse plus rien               | rouge |
| Un cahier absent est pris pour un conflit                | rouge |
| L'index est interrogé sur la mauvaise version            | rouge |
| L'index n'est pas créé à la migration                    | rouge |
| La version de base n'est pas montée                      | rouge |
| La fiche garde le cahier entier                          | rouge |
| La pastille est calculée trop tard, donc vide            | rouge |
| La mémorisation ignore le cahier                         | rouge |
| La mémorisation ignore les identifiants                  | rouge |
| L'historique décrit encore tout pour montrer douze       | rouge |
| Le repli de démarrage remonte l'index à l'envers         | rouge |
| Le repli de démarrage abandonne au premier illisible     | rouge |
| Le compteur des filtres de recherche compte faux         | rouge |
| L'ordre des natures de résultat vient d'ailleurs         | rouge |
| « All » ne compte plus tout                              | rouge |
| `listTasks` n'écarte plus un cahier illisible            | rouge |

Trois d'entre elles ont survécu au premier essai, et c'est exactement ce
qu'on leur demande : les comptes portés par les filtres de recherche, leur
ordre, et le filet qui écarte un cahier illisible de la liste n'étaient tenus
par rien. Quatre épreuves de plus, écrites après coup.

Une quatrième « survivante » était une erreur de sonde : mon script mutait le
mauvais `catch` du même fichier. Consignée, pour qu'elle ne passe pas plus tard
pour un défaut.

---

## Vérification en navigateur

Chrome, `npm run dev`, un cahier de 40 règles et 30 approches écartées écrit
directement dans IndexedDB puis rechargé.

**Observé.** 12 lignes de règles sur 40, la phrase « 28 rules still in force are
not shown », le bouton « Show all 40 rules » ; 12 lignes d'approches écartées
sur 30 avec son propre bouton ; 360 nœuds dans `#app`. Après clic : 40 lignes,
l'avertissement disparu, le bouton devenu « Show fewer », le focus resté sur
le bouton, 499 nœuds. L'avertissement et le bouton ont des styles calculés
réels (`rgb(230, 230, 234)`, 15 px, un rectangle de 152 × 41 px) et ne sont
donc ni invisibles ni sans mise en forme.

**Pas de capture d'écran.** Le panneau de capture de cet environnement a rendu
des images vides alors que le DOM, lui, répondait correctement. Je le note
plutôt que de présenter une image qui ne montre rien.

**Second tour, après l'index et la fiche.** La base est passée de la version 2
à la 3 sur place : un cahier de 798 ko a survécu à la montée, les deux index
sont présents, et l'index composé rend bien `perf01` pour la bonne version et
rien pour une mauvaise. Une règle ajoutée depuis l'écran a été écrite en 20,5 ms
de bout en bout. `lastTaskId` effacé, la page a retrouvé son cahier seule. Une
frappe dans la recherche, image comprise : 6,9 ms sur ce même cahier.

**Une anomalie non reproduite.** Au premier essai, la page est restée sur
« Loading… » après l'écriture directe dans IndexedDB. Après vidage de la base et
réécriture du même cahier, elle s'est chargée normalement, et une connexion
IndexedDB tenue ouverte en parallèle ne reproduit pas le blocage. Aucun
mécanisme établi ; consigné comme non expliqué plutôt que classé sans suite.

---

## Ce que ce travail ne couvre pas

- **Aucune mesure sur un vrai navigateur.** Les durées viennent de jsdom, où le
  rendu est plus lent et le style absent. Les tailles, les nœuds et les tokens,
  eux, ne dépendent pas du moteur.
- **Aucune mesure sur mobile**, ni sur un poste lent.
- **Aucune mesure de mémoire**. Le cahier est tenu en entier en mémoire ; rien
  n'a été mesuré de ce côté.
- **Aucune borne sur ce qu'un cahier reçu peut porter** au-delà de la
  décompression, plafonnée à 2 Mo. Point déjà signalé au second audit.
