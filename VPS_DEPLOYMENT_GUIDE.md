# 🚀 Guide de Déploiement Frontend sur VPS

**VPS Info :**
- IP : `51.210.7.36`
- OS : Ubuntu
- SSH : `ssh ubuntu@51.210.7.36`
- URL d'accès : `http://51.210.7.36` (après déploiement)

---

## 📋 ÉTAPE 1 : Configuration Supabase (sur ton PC Windows)

**1.1 Créer le fichier .env.production**

Dans ton dossier `C:\Dossier Walid\logic_extractor_mvp\`, crée un fichier `.env.production` :

```env
VITE_SUPABASE_URL=https://pjkgjmkbrjpagksaznpk.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqa2dqbWticmpwYWdrc2F6bnBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMTkwODksImV4cCI6MjA3ODY5NTA4OX0._b3gCfOBHizlXoIxv1wNvAgajv5JmgeJYkVL2V_Z740
```

**1.2 Build le frontend**

```powershell
cd "C:\Dossier Walid\logic_extractor_mvp"

# Installer les dépendances (si pas déjà fait)
npm install

# Build production
npm run build
```

✅ Cela crée un dossier `dist/` avec tous les fichiers statiques optimisés.

---

## 📋 ÉTAPE 2 : Installation Nginx sur VPS

**2.1 Connexion SSH**

```powershell
ssh ubuntu@51.210.7.36
```

**2.2 Installer Nginx**

```bash
# Update packages
sudo apt update

# Installer Nginx
sudo apt install -y nginx

# Vérifier que Nginx tourne
sudo systemctl status nginx

# Démarrer Nginx si pas déjà démarré
sudo systemctl start nginx
sudo systemctl enable nginx
```

**2.3 Vérifier dans ton navigateur**

Ouvre `http://51.210.7.36` → Tu devrais voir la page par défaut de Nginx ("Welcome to nginx!")

✅ Nginx est installé !

---

## 📋 ÉTAPE 3 : Transférer le frontend vers VPS

**3.1 Sur ton PC Windows (PowerShell)**

```powershell
# Depuis C:\Dossier Walid\logic_extractor_mvp

# Transférer le dossier dist/ vers VPS
scp -r dist/* ubuntu@51.210.7.36:/tmp/frontend/
```

**Note :** Si demandé, tape `yes` pour accepter la clé SSH.

**3.2 Sur le VPS (SSH)**

```bash
# Créer le dossier de destination
sudo mkdir -p /var/www/logic-extractor

# Copier les fichiers
sudo cp -r /tmp/frontend/* /var/www/logic-extractor/

# Donner les bonnes permissions
sudo chown -R www-data:www-data /var/www/logic-extractor
sudo chmod -R 755 /var/www/logic-extractor

# Vérifier les fichiers
ls -la /var/www/logic-extractor
```

✅ Frontend transféré !

---

## 📋 ÉTAPE 4 : Configurer Nginx

**4.1 Créer la configuration Nginx (sur VPS)**

```bash
sudo nano /etc/nginx/sites-available/logic-extractor
```

**Copie-colle cette configuration :**

```nginx
server {
    listen 80;
    server_name 51.210.7.36;

    root /var/www/logic-extractor;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache les assets statiques
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Logs
    access_log /var/log/nginx/logic-extractor-access.log;
    error_log /var/log/nginx/logic-extractor-error.log;
}
```

**4.2 Activer la configuration**

```bash
# Créer le lien symbolique
sudo ln -s /etc/nginx/sites-available/logic-extractor /etc/nginx/sites-enabled/

# Supprimer la config par défaut (optionnel)
sudo rm /etc/nginx/sites-enabled/default

# Tester la configuration
sudo nginx -t

# Si OK, recharger Nginx
sudo systemctl reload nginx
```

✅ Configuration Nginx terminée !

---

## 📋 ÉTAPE 5 : Tester le frontend

**5.1 Ouvre ton navigateur**

Va sur : `http://51.210.7.36`

Tu devrais voir ton application Logic Extractor ! 🎉

---

## 📋 ÉTAPE 6 : Keep-Alive Supabase (éviter cold start)

**6.1 Créer le script de ping (sur VPS)**

```bash
# Créer le script
sudo nano /usr/local/bin/supabase-keepalive.sh
```

**Copie-colle :**

```bash
#!/bin/bash
# Ping Supabase Edge Functions toutes les 10 min pour éviter cold start

curl -s -X OPTIONS https://pjkgjmkbrjpagksaznpk.supabase.co/functions/v1/upload-documents \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqa2dqbWticmpwYWdrc2F6bnBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxMTkwODksImV4cCI6MjA3ODY5NTA4OX0._b3gCfOBHizlXoIxv1wNvAgajv5JmgeJYkVL2V_Z740" \
  > /dev/null 2>&1
```

**6.2 Rendre le script exécutable**

```bash
sudo chmod +x /usr/local/bin/supabase-keepalive.sh
```

**6.3 Créer le cron job**

```bash
# Éditer crontab
crontab -e

# Ajouter cette ligne (ping toutes les 10 min)
*/10 * * * * /usr/local/bin/supabase-keepalive.sh
```

✅ Supabase ne dormira plus jamais ! (0 cold start)

---

## 📋 ÉTAPE 7 : Firewall (Sécurité)

**7.1 Configurer UFW (sur VPS)**

```bash
# Activer le firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Vérifier
sudo ufw status
```

---

## 🎯 Résumé Final

| Service | URL/IP | Status |
|---------|--------|--------|
| **Frontend** | http://51.210.7.36 | ✅ Toujours actif |
| **Backend (Supabase)** | https://pjkgjmkbrjpagksaznpk.supabase.co | ✅ Toujours actif (keep-alive) |
| **Database** | Supabase PostgreSQL | ✅ Managed |

---

## 🔄 Pour mettre à jour le frontend plus tard

```powershell
# Sur ton PC
cd "C:\Dossier Walid\logic_extractor_mvp"
git pull
npm run build
scp -r dist/* ubuntu@51.210.7.36:/tmp/frontend/

# Sur VPS
ssh ubuntu@51.210.7.36
sudo cp -r /tmp/frontend/* /var/www/logic-extractor/
sudo systemctl reload nginx
```

---

## 🆘 Troubleshooting

**Problème : Page blanche**
```bash
# Sur VPS, vérifier les logs
sudo tail -f /var/log/nginx/logic-extractor-error.log
```

**Problème : 404 Not Found**
```bash
# Vérifier que les fichiers sont bien là
ls -la /var/www/logic-extractor
```

**Problème : Cannot connect to Supabase**
- Vérifier que `.env.production` est bien configuré
- Re-build : `npm run build`

---

## 🎉 Félicitations !

Ton application est maintenant **100% en ligne** :
- ✅ Frontend sur VPS (http://51.210.7.36)
- ✅ Backend sur Supabase (serverless)
- ✅ Zero cold start (keep-alive actif)
- ✅ Accessible 24/7 sur le web

**Partage l'URL `http://51.210.7.36` et les gens peuvent l'utiliser directement !** 🚀
