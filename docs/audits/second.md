# Second audit — 28 août 2026

Le [premier audit](../audits/premier.md) portait sur le produit tel qu'il était
alors. Une dizaine de lots de fonctionnalités ont suivi sans jamais être
éprouvés adversairement. Celui-ci ne vise qu'eux.

**Périmètre.** `request_approval` et son attente bloquante, les contestations,
le lien partageable, la barre « Needs you », la garde anti-répétition, la
durabilité du stockage, la reprise des règles, l'extension de l'annulation, le
but (`DONE WHEN`), la copie en texte, les pastilles du sélecteur, le bandeau
d'appel d'agent, et l'histoire d'un élément.

**État au début :** 755 tests. **À la fin :** 776, dont 21 nouveaux couvrant ce
qui a été trouvé.

---

## Défauts trouvés et corrigés

### 1. Un lien pouvait faire exploser le navigateur de celui qui l'ouvre

**Gravité : élevée.** `packTask` bornait la longueur du lien **produit**. Rien
ne bornait ce qui était **reçu**. Or le lien est ouvert par la victime : borner
la sortie de son propre navigateur ne protège de personne.

Deux charges construites pendant l'audit, toutes deux **sous** la borne de
16 000 caractères :

| Charge                               | Avant                        | Après            |
| ------------------------------------ | ---------------------------- | ---------------- |
| Un titre de 6 Mo, compressé par gzip | acceptée, 6 Mo reconstruits  | refusée          |
| 60 000 étapes                        | acceptée en **6,2 secondes** | refusée en 86 ms |

Le ratio de compression de gzip atteint environ 1000:1 : quelques kilo-octets
d'adresse suffisent à en produire plusieurs mégaoctets.

**Correctif.** La décompression est bornée à 2 Mo et **s'arrête dès le
dépassement**, pas après. Le fragment entrant est en outre refusé au-delà de la
borne que l'on sait produire : on n'accepte que ce que l'on émet.

### 2. Un cahier reçu pouvait porter un journal sans fin

**Gravité : moyenne.** À l'écriture, le journal est borné à
`MAX_AUDIT_ENTRIES`. À la lecture d'un cahier venu d'ailleurs — lien ou import
de fichier — aucune borne ne s'appliquait. La normalisation applique désormais
la même, et garde les entrées les plus récentes, comme à l'écriture.

### 3. La première pose d'un but ou d'une prochaine action n'était pas annulable

**Gravité : moyenne.** L'entrée d'audit ne portait `previous` que si l'ancienne
valeur n'était pas vide. « Il n'y avait rien » devenait donc indistinguable de
« rien n'a été consigné », et l'annulation refusait d'agir.

Trouvé en enchaînant trois annulations : la troisième échouait.

**Correctif.** La valeur remplacée est **toujours** consignée, la chaîne vide
disant « il n'y avait rien ». Et la comparaison normalise `null` et `''`, sans
quoi la deuxième annulation reproposait ce qu'elle venait de défaire.

### 4. L'histoire d'un élément s'appauvrissait en silence

**Gravité : moyenne.** Le journal est borné à `MAX_AUDIT_ENTRIES`. Passé cette
limite, l'histoire d'une règle ancienne perdait ses entrées **sans le dire** —
et une histoire vide se lit « il ne s'est rien passé », ce qui est faux. Le
comble, dans un produit qui reproche exactement cela aux résumés de
conversation, et alors que `what_changed` annonce son propre élagage depuis le
début.

Ce point figurait d'abord en « connu, non corrigé ». Il a été traité ensuite.

**Correctif.** `historyOf` ne rend plus une liste mais
`{ entries, mayBeIncomplete }` : l'incomplétude voyage **avec** les entrées,
et non dans une fonction voisine que l'appelant pourrait oublier d'appeler —
c'était précisément le mode de défaillance à écarter. Le bouton **History**
reste offert même sans entrée survivante, sans quoi cacher le bouton
reviendrait à taire l'élagage.

L'avertissement dit « peut ne pas être toute l'histoire » et non un nombre : le
marqueur d'élagage compte des entrées, pas des cibles, et l'on ne sait donc pas
ce qui a été écarté **pour cet élément**.

### 5. Du code défensif que rien ne pouvait atteindre

**Gravité : faible (dette).** Après le correctif n°1, la borne posée sur le
repli non compressé était devenue inatteignable — la borne d'entrée la domine
strictement. Un test de mutation l'a montrée survivante, c'est-à-dire morte.
Retirée, avec un commentaire disant pourquoi la borne d'entrée suffit là.

---

## Deux tests qui passaient pour la mauvaise raison

Ils sont rapportés ici parce qu'un test qui passe sans rien démontrer est pire
qu'un test absent : il inspire une confiance qu'il ne mérite pas.

1. **La pastille du sélecteur.** Le test vérifiait qu'une ligne contenait
   « blocked » — sur une tâche intitulée **« Blocked task »**. C'était le titre
   qui satisfaisait l'assertion. Tâche renommée, assertion portée sur
   l'élément.
2. **Les deux bornes du lien.** Chacune masquait l'autre : la charge trop
   longue échouait de toute façon au décodage, et la charge non compressée
   démesurée était arrêtée par la borne d'entrée. Les deux tests passaient sans
   rien prouver. Isolés — un cahier **parfaitement valide**, simplement trop
   long, que seule la borne d'entrée refuse.

Dans les deux cas, c'est le **test de mutation** qui a révélé le problème : la
garde cassée, la suite restait verte.

---

## Ce qui a été éprouvé et tient

### Une attente d'autorisation pendant que tout bouge

| Épreuve                                      | Résultat                      |
| -------------------------------------------- | ----------------------------- |
| La tâche est **supprimée** pendant l'attente | `NO ANSWER`, jamais `ALLOWED` |
| On **change de cahier** pendant l'attente    | `NO ANSWER`                   |
| L'exécution est annulée                      | rendue en moins d'une seconde |

### Chaînes d'annulation

Trois corrections d'affilée — renommage, but, prochaine action — annulées une
par une dans l'ordre inverse, chacune rendant exactement sa valeur. La chaîne
s'arrête net devant une écriture d'agent, et ne propose plus rien une fois tout
rendu.

### Bornes des surfaces récentes

- Le résumé du sélecteur reste sous 70 caractères avec **200** propositions en
  attente.
- Le but survit à une clôture et reste modifiable ensuite : l'humain reste
  maître d'une tâche close.
- Le filtre de recherche ne se transmet pas d'un cahier à l'autre.
- L'histoire d'un élément ne mélange pas deux règles, et suit celle qui a été
  proposée puis acceptée.

### Tests de mutation — onze garanties récentes

| Garantie cassée                       | Suite |
| ------------------------------------- | ----- |
| Bombe de décompression acceptée       | rouge |
| Fragment entrant sans borne           | rouge |
| Journal reçu sans borne               | rouge |
| Vide non normalisé à l'annulation     | rouge |
| Première pose de but non annulable    | rouge |
| Résumé qui énumère tout               | rouge |
| Appel ancien présenté comme récent    | rouge |
| Histoire d'un élément mélangeant tout | rouge |
| Élagage tu à l'appelant               | rouge |
| Bouton caché quand tout est élagué    | rouge |
| Avertissement retiré de l'écran       | rouge |

Deux d'entre elles — les deux bornes du lien — n'ont été tuées qu'**après**
correction des tests décrits plus haut.

---

## Connu, non corrigé

### La barre « Needs you » reste active sur un cahier archivé

Signalé au premier audit, toujours vrai : archiver n'est pas clore.

### Bornes de mémoire au-delà du lien

`normalizeTask` borne le journal et les mutations, pas les étapes, les
décisions ni les rejets. Un cahier reçu portant 40 000 étapes tiendrait sous
2 Mo et serait accepté. Aucune surface ne s'effondre — toutes tranchent ce
qu'elles affichent — mais rien ne le borne non plus.

---

## Ce que ce second audit ne couvre pas

- **Aucune vérification en navigateur.** Le navigateur de contrôle n'a pas pu
  être relancé dans cet environnement, et je préfère l'écrire plutôt que de
  laisser croire à une vérification qui n'a pas eu lieu. Les tests exercent
  cependant les **vraies** `CompressionStream` et `DecompressionStream` de la
  plateforme, et non des doublures. Les relevés navigateur des passes
  précédentes, eux, tiennent toujours.
- **Aucune revue du chiffrement**, ni du service worker, ni du manifeste : ils
  n'ont pas changé depuis le premier audit.
- **Aucune mesure de performance**, hormis les deux durées citées pour la bombe
  de décompression, mesurées par la suite de tests et non sur un poste réel.
