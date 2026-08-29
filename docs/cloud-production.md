# Comptes, synchronisation et connecteurs en production

Nightorder fonctionne réellement sans cloud : IndexedDB reste la copie
de travail locale et les 13 outils WebMCP continuent de fonctionner. Les étapes
ci-dessous activent le second mode du produit : compte passwordless, workspace
privé, synchronisation multi-appareil et connecteurs OpenAI, Anthropic et
Gemini.

Ce document ne prétend pas que ces services sont actifs avant leur déploiement.
L'interface affiche explicitement **Local only** tant que les deux variables
Supabase publiques ne sont pas présentes.

## 1. Créer et lier le projet Supabase

Installer la CLI Supabase, se connecter, puis depuis la racine du dépôt :

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

`supabase db push` applique
`supabase/migrations/202608280001_nightorder_cloud.sql`. La migration crée :

- profils, workspaces et membres avec rôles `owner`, `editor`, `viewer` ;
- paramètres privés par workspace ;
- snapshots versionnés des tâches ;
- métadonnées des connecteurs ;
- tentatives de connexion et événements d'audit ;
- politiques Row Level Security sur chaque table exposée ;
- la fonction transactionnelle `sync_task_snapshot`, qui refuse tout retour de
  version.

La colonne chiffrée d'un connecteur n'est pas accordée au rôle
`authenticated`. Même un utilisateur autorisé ne peut lire que son état, son
libellé et son empreinte courte ; seul le rôle serveur peut toucher au secret.

## 2. Configurer l'authentification

Dans **Authentication → URL Configuration** :

- **Site URL** : l'origine de production exacte ;
- **Redirect URLs** : cette même origine, puis les origines locales utilisées
  (`http://localhost:5173` et `http://127.0.0.1:5173`).

Le client utilise le flux PKCE et conserve la session dans `sessionStorage`.
Fermer l'onglet supprime donc la copie locale du jeton. Le bouton **Sign out all
devices** révoque les autres sessions via Supabase Auth.

Configurer un SMTP de production dans **Authentication → Email** avant une
démonstration publique. Le service d'envoi par défaut de Supabase est destiné
aux essais, impose des limites faibles et ne constitue pas une garantie de
livraison.

## 3. Déployer la fonction de connecteur

Générer une clé maître dédiée :

```bash
openssl rand -base64 32
```

La sortie doit rester secrète. Ne jamais la préfixer par `VITE_`, ne jamais la
placer dans Vercel et ne jamais la committer.

```bash
supabase secrets set CONNECTOR_MASTER_KEY="PASTE_BASE64_VALUE"
supabase secrets set ALLOWED_ORIGINS="https://your-production-domain.example"
supabase functions deploy connector-credentials
```

La fonction exige un JWT valide, vérifie le rôle du membre, limite les essais à
10 par tranche de 10 minutes et par utilisateur/workspace, teste la clé auprès
du fournisseur avec un délai maximal de 10 secondes, puis chiffre la valeur en
AES-256-GCM. Elle ne renvoie jamais la clé au navigateur.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées
par Supabase dans la fonction déployée. La service-role key ne doit apparaître
nulle part ailleurs.

## 4. Variables du frontend

Dans Vercel, ajouter pour **Production** et, si nécessaire, pour les previews
contrôlées :

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

Ces valeurs sont publiques par nature. La sécurité vient des politiques RLS,
pas de leur dissimulation. Ne jamais utiliser la service-role key dans le
frontend.

Le jeton WebMCP d'origin trial reste indépendant ; sa procédure est décrite
dans [`docs/deploiement.md`](deploiement.md).

## 5. Rétention et exploitation

La migration crée `private.prune_expired_audit()`. Planifier son exécution
quotidienne avec Supabase Cron/pg_cron ou un job serveur de confiance :

```sql
select private.prune_expired_audit();
```

Le délai vient de `workspace_settings.retention_days`. Le mode **Forever**
conserve l'audit ; les autres valeurs suppriment uniquement les événements
arrivés à expiration. Les snapshots actifs ne sont pas effacés par cette
fonction.

Pour la supervision, activer les alertes Supabase sur les erreurs de fonction,
le taux d'échecs Auth et la saturation de la base. Ne jamais journaliser le
corps des requêtes de connexion : il contient momentanément une clé fournisseur.

## 6. Vérification avant ouverture publique

Faire ces essais avec deux comptes distincts et une fenêtre privée :

1. Un lien magique ouvre une session et crée un workspace propriétaire.
2. Une tâche locale passe en **Synced** après activation de Cloud sync.
3. Le second compte ne peut lire ni le workspace, ni les snapshots, ni les
   connecteurs du premier, même par requête directe à l'API REST.
4. Une version distante plus ancienne n'écrase jamais une version locale plus
   récente.
5. Une vraie clé fournisseur valide passe à **Connected** ; une clé invalide
   produit une erreur sans rester dans le DOM, IndexedDB ou les logs réseau de
   réponse.
6. **Disconnect** supprime la ligne chiffrée du connecteur.
7. **Sign out all devices** invalide une seconde session ouverte.
8. Après suppression d'une tâche, ses secrets locaux sont supprimés avant la
   tâche ; un échec de suppression garde la tâche visible et remonte l'erreur.
9. Un import supérieur à 2 Mio et un lien partagé décompressé supérieur à
   1 Mio sont refusés.
10. `npm run check` termine sans erreur sur le commit déployé.

## 7. Limites assumées

- La synchronisation est un miroir de snapshots versionnés, pas un éditeur
  collaboratif caractère par caractère. La version la plus élevée gagne ; à
  version égale, le serveur ne remplace pas l'état existant.
- Les connecteurs vérifient et conservent les clés de façon sécurisée. Ils ne
  donnent pas au navigateur un accès direct aux conversations privées d'un
  fournisseur : une telle ingestion demanderait des OAuth et API officiellement
  disponibles pour chaque fournisseur, avec consentement et scopes séparés.
- Le produit est gratuit. Les appels futurs utilisant une clé OpenAI,
  Anthropic ou Gemini restent soumis aux prix et limites de ce fournisseur.
