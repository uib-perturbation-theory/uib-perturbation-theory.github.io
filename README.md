# Gravity Group @ UIB — web del grupo

Sitio estático (HTML + CSS puro, sin frameworks ni build) pensado para GitHub Pages.

## Estructura

```
index.html          Portada (hero con ringdown animado + resumen)
research.html       Líneas de investigación
team.html           Equipo (fichas con foto, cargo y email)
publications.html   Publicaciones por año
news.html           Noticias
contact.html        Contacto
css/style.css       Estilos compartidos
assets/             Fotos del equipo e imágenes
```

## Cómo publicarla en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `gravity-uib.github.io` si creáis
   una organización, o `web` dentro de vuestra cuenta).
2. Sube estos archivos a la rama `main`:
   ```bash
   git init
   git add .
   git commit -m "Web del grupo"
   git branch -M main
   git remote add origin git@github.com:USUARIO/REPO.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Source: Deploy from a branch →
   Branch: main / (root) → Save**.
4. En 1–2 minutos la web estará en `https://USUARIO.github.io/REPO/`.
   - Si el repo se llama `USUARIO.github.io`, la URL será `https://USUARIO.github.io/` directamente.
5. (Opcional) Dominio propio: añadidlo en Settings → Pages → Custom domain
   y cread el registro CNAME en vuestro DNS.

## Cómo editar el contenido

- **Añadir una persona**: en `team.html`, copia un bloque `<div class="person">…</div>`.
  Para poner foto real, sustituye
  `<div class="photo placeholder">?</div>` por
  `<img class="photo" src="assets/nombre.jpg" alt="Nombre">`.
  Las fotos quedan mejor cuadradas (p. ej. 800×800).
- **Añadir un paper**: en `publications.html`, copia un bloque `<div class="pub">…</div>`.
- **Añadir una noticia**: en `news.html`, copia un bloque `<div class="news-item">…</div>`
  (las más recientes arriba). Recuerda actualizar también las 2–3 destacadas de `index.html`.
- Busca la palabra `PLACEHOLDER` para localizar todo lo que falta por rellenar.

## Probar en local

No necesita servidor: abre `index.html` en el navegador. Si prefieres un
servidor local: `python3 -m http.server` y visita http://localhost:8000.
