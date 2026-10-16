# Installer « Finances du ménage » chez vous

Ce guide est pour vous deux. Comptez **30 à 45 minutes**, une seule fois, sur un ordinateur. Rien à installer : l'app est un site web privé que vous ouvrez ensuite sur vos téléphones et votre ordi.

**Ce qu'il vous faut**

- Les deux adresses courriel avec lesquelles vous allez vous connecter.
- Un compte **Supabase** (gratuit) : c'est la base de données, là où vos chiffres sont gardés.
- Un compte **GitHub** (gratuit) : c'est ce qui héberge la page web et met à jour les prix de la bourse chaque soir.

Les deux comptes sont **à vous**. Personne d'autre (y compris la personne qui vous a envoyé l'app) n'a accès à vos données.

> Les noms des menus chez Supabase et GitHub changent parfois un peu. Si un libellé ne correspond pas exactement, cherchez le plus proche.

---

## 1. Décompresser l'app

Double-cliquez sur `finances-menage-ami.zip`. Un dossier `finances-menage-ami` apparaît.

Il contient un dossier caché `.github` (c'est lui qui fait la mise à jour des prix). Pour le voir dans le Finder : ouvrez le dossier et appuyez sur **Cmd + Maj + .** (point). Sur Windows : *Affichage → Éléments masqués*.

## 2. Créer la base de données (Supabase)

1. Allez sur [supabase.com](https://supabase.com), créez un compte, puis **New project**.
   - Nom : ce que vous voulez (ex. `finances`).
   - Région : **Canada (Central)** si offert.
   - Mot de passe de la base : générez-le et **gardez-le dans un endroit sûr** (gestionnaire de mots de passe).
2. Attendez une minute que le projet soit prêt.
3. Dans le menu de gauche : **SQL Editor → New query**.
4. Ouvrez le fichier `supabase/schema.sql` (clic droit → *Ouvrir avec* → TextEdit), **copiez tout**, et collez-le dans Supabase.
5. Tout en haut du texte collé, remplacez les deux courriels d'exemple par les vôtres :
   ```
   ('person1@example.com'),   ← votre courriel
   ('person2@example.com')    ← le courriel de votre conjoint·e
   ```
   Gardez les apostrophes, les parenthèses et la virgule.
6. Cliquez **Run**. Vous devez voir « Success ».

## 3. Créer vos deux connexions

1. **Authentication → Sign In / Providers** (ou *Providers → Email*) : laissez *Email* activé, et **désactivez « Allow new users to sign up »**. Ainsi, personne d'autre ne peut se créer un compte.
2. **Authentication → Users → Add user → Create new user** :
   - votre courriel (le même que dans l'étape 2) et un mot de passe;
   - cochez **Auto confirm user**.
3. Refaites la même chose pour votre conjoint·e.

## 4. Mettre l'app sur GitHub

1. Allez sur [github.com](https://github.com) et créez un compte.
2. En haut à droite : **+ → New repository**.
   - Nom : `finances` (ou autre).
   - Visibilité : **Public**. C'est nécessaire pour l'hébergement gratuit, et c'est sans risque : le dépôt ne contient que le code de l'app, **jamais vos chiffres**.
   - Ne cochez rien d'autre. Cliquez **Create repository**.
3. Sur la page qui s'affiche, cliquez le lien **uploading an existing file**.
4. Dans le Finder, ouvrez le dossier `finances-menage-ami` (avec les fichiers cachés visibles, voir l'étape 1), **sélectionnez tout son contenu** (Cmd + A) et glissez-le dans la page GitHub. Ne glissez pas le dossier lui-même, mais ce qu'il contient.
5. Attendez que les fichiers soient listés, puis cliquez **Commit changes**.
6. Vérifiez que la liste des fichiers du dépôt contient bien un dossier **`.github`**. S'il manque, voyez « Si le dossier .github manque » à la fin.

## 5. Brancher la page sur votre base de données

1. Dans Supabase : **Project Settings → API Keys** (anciens projets : *Settings → API*).
2. Copiez :
   - le **Project URL** (ressemble à `https://abcdefgh.supabase.co`);
   - la clé **publishable** (anciens projets : la clé `anon` `public`).
3. Dans GitHub, cliquez sur le fichier `config.js`, puis sur le **crayon** (Edit).
4. Remplacez les deux valeurs entre apostrophes :
   ```js
   SUPABASE_URL: 'https://abcdefgh.supabase.co',
   SUPABASE_KEY: 'sb_publishable_...',
   ```
5. Cliquez **Commit changes**.

Ces deux valeurs sont faites pour être publiques; ce sont les règles d'accès de l'étape 2 qui protègent vos données. **Ne mettez jamais la clé *secret* (ou `service_role`) dans `config.js`.**

## 6. Ouvrir le site

1. Dans GitHub : **Settings → Pages**.
2. *Build and deployment* → *Source* : **Deploy from a branch**, branche **main**, dossier **/ (root)**, **Save**.
3. Après une ou deux minutes, votre site est à :
   `https://VOTRE-NOM-GITHUB.github.io/finances/`
4. Ouvrez-le, connectez-vous avec le courriel et le mot de passe de l'étape 3.
5. Sur vos téléphones : ouvrez l'adresse, puis **Partager → Sur l'écran d'accueil**. L'app s'ouvre alors comme une vraie app.

## 7. Activer la mise à jour des prix chaque soir

1. Dans Supabase : **Project Settings → API Keys**, copiez la clé **secret** (anciens projets : `service_role`). Cette clé donne accès à tout : elle va **seulement** dans les secrets de GitHub. Ne l'envoyez à personne, ni par texto ni par courriel.
2. Dans GitHub : **Settings → Secrets and variables → Actions → New repository secret**. Ajoutez-en deux :
   - Nom `SUPABASE_URL`, valeur : le Project URL.
   - Nom `SUPABASE_SERVICE_KEY`, valeur : la clé secret.
3. Ouvrez l'onglet **Actions**. Si GitHub le demande, cliquez **I understand my workflows, go ahead and enable them**.
4. Cliquez **Update closing prices → Run workflow → Run workflow**. Une coche verte après une minute = tout fonctionne.

Ensuite, ça roule tout seul du lundi au vendredi vers 18 h 30 (17 h 30 en hiver), après la fermeture des marchés.

## 8. Premiers pas dans l'app

- **Réglages** (en haut) : mettez vos deux prénoms.
- **Portfolio** : deux sections. **Placements publics** (FNB, actions, encaisse) : le cours se met à jour chaque soir de bourse; symboles sans suffixe (`XEQT`, `VFV`). **Placements privés** (fonds privés, actions de votre compagnie, prêts privés…) : vous entrez la valeur, avec un rappel chaque mois ou trimestre. Le bouton **Importer** lit un fichier Excel ou CSV de votre courtier, ou un lien Google Sheets, et vous montre ce qui sera ajouté ou mis à jour avant d'enregistrer. Après vos premiers placements, relancez l'étape 7.4 pour avoir les prix tout de suite.
- **Actifs** : maison, comptes bancaires, autos… avec une valeur estimée.
- **Budget** : dépenses fixes, revenus, enveloppes. **Importer des relevés** lit les fichiers CSV de RBC (et la plupart des autres banques). Le fichier est lu dans votre navigateur et n'est jamais envoyé ailleurs.
- Aussi dans **Portfolio** : la **répartition des actifs** (actions, obligations…) avec une cible, les **achats et ventes** (gains en capital imposables ou à l'abri), et les **droits CELI et REER** de chacun.
- **Enfants**, **Dettes**, **Projets** : comme leur nom l'indique.
- **Compagnies** : les revenus et dépenses de vos compagnies (incorporée ou travailleur autonome), le salaire et les dividendes que vous vous versez. L'app estime l'impôt de la compagnie, votre impôt personnel et ce qui reste dans vos poches, et compare « tout en salaire » et « tout en dividendes ». Le bouton **Ajouter au Budget** inscrit ce montant net comme revenu. Ce sont des estimations : validez avec votre comptable.
- **Projections** : votre avoir net année par année, avec vos hypothèses (rendement, inflation, immobilier, hausses de salaire, coûts des enfants, âge de retraite, RRQ et PSV). Entrez vos années de naissance pour voir la retraite.
- **Exporter** (en haut) : télécharge toutes vos données dans un fichier Excel. Faites-le de temps en temps : c'est votre copie de sécurité.
- **Ménage / Personne 1 / Personne 2** en haut change la vue. Ce qui est *Commun* compte 50/50.

---

## Si ça arrête de fonctionner

- **Les prix ne se mettent plus à jour.** GitHub met en pause les tâches automatiques d'un dépôt public après **60 jours sans modification** du dépôt (il envoie un courriel avant). Onglet **Actions → Update closing prices → Enable workflow**.
- **Le site affiche une erreur de connexion.** Supabase met en pause les projets gratuits inactifs. Dans Supabase, ouvrez le projet et cliquez **Restore project**. La mise à jour quotidienne des prix l'empêche normalement de dormir.
- **Mot de passe oublié.** Dans Supabase : **Authentication → Users**, cliquez sur l'utilisateur et changez son mot de passe.

## Si le dossier .github manque

Dans GitHub : **Add file → Create new file**. Comme nom, tapez exactement :

```
.github/workflows/prices.yml
```

Ouvrez `.github/workflows/prices.yml` du dossier décompressé avec TextEdit, copiez tout, collez-le dans GitHub, puis **Commit changes**.

## Rappels par courriel

Chaque soir de semaine, après les prix, GitHub vérifie trois choses : un placement privé à mettre à jour, un terme d'hypothèque qui finit dans moins de 120 jours, et la date limite REER en février. S'il y a quelque chose, un « issue » nommé **Rappels** apparaît dans l'onglet **Issues** de votre dépôt, et GitHub vous l'envoie par courriel. Vérifiez dans GitHub (**Settings → Notifications**) que les courriels sont activés.

## Modifier l'app avec Claude, sur votre ordi

L'app est faite pour être modifiée avec Claude : le fichier `CLAUDE.md` lui explique comment elle fonctionne, et une page de test (`dev.html`) lui permet d'essayer les changements avec des données fictives, sans toucher à vos vrais chiffres.

1. Installez **GitHub Desktop** (desktop.github.com) et connectez-vous avec votre compte GitHub.
2. **File → Clone repository**, choisissez `finances-menage`. Comme dossier, prenez votre dossier personnel (par exemple `/Users/votre-nom/finances-menage`), **pas** le Bureau ni Documents : macOS y bloque certains outils.
3. Dans l'app **Claude** (onglet Code), ouvrez ce dossier et demandez ce que vous voulez, en français. Claude essaie le changement dans la page de test, lance les vérifications, puis vous montre le résultat.
4. Quand c'est bon, demandez à Claude de faire le commit, puis cliquez **Push origin** dans GitHub Desktop. Votre site se met à jour en une ou deux minutes.
5. Si Claude ajoute une table ou une colonne à la base de données, il vous le dira : relancez alors `supabase/schema.sql` dans Supabase (étape 2), avec vos deux courriels.

## Recevoir une nouvelle version

Si on vous envoie une nouvelle version de l'app : téléversez les nouveaux fichiers dans votre dépôt GitHub (**Add file → Upload files**), **sauf `config.js`** (gardez le vôtre). Le dossier caché `.github` ne passe souvent pas par le glisser-déposer : ouvrez alors `.github/workflows/prices.yml` sur GitHub, cliquez le crayon et collez la nouvelle version. Puis relancez `supabase/schema.sql` dans le SQL Editor, avec vos deux courriels dedans. C'est sans danger : ça ajoute seulement ce qui manque, vos données restent. Si l'app affiche « Nouveautés à activer », c'est cette étape qui manque.

Avec GitHub Desktop (section précédente), c'est plus simple : copiez les nouveaux fichiers dans votre dossier (sauf `config.js`), puis **Commit** et **Push origin**.
