# Notre quotidien V1

PWA familiale connectée à Supabase.

## Publication GitHub Pages
1. Créer un dépôt public `notre-quotidien`.
2. Déposer tous les fichiers à la racine du dépôt.
3. Dans Settings > Pages, choisir Deploy from a branch, branche `main`, dossier `/ (root)`.
4. Dans Supabase Authentication > URL Configuration, définir la Site URL sur l’adresse GitHub Pages et ajouter la même adresse aux Redirect URLs.

## Sécurité
- La clé présente dans `supabase-config.js` est une clé publique destinée au navigateur.
- Ne jamais ajouter une clé `sb_secret_`, `service_role`, un mot de passe ou une chaîne PostgreSQL dans ce dépôt.
- Les accès aux données reposent sur Supabase Auth et les politiques RLS.

## Limite de cette V1
L’interface permet d’activer le souhait de notification sur une tâche, mais l’envoi Web Push en arrière-plan sera ajouté dans la phase Cloudflare Worker.
