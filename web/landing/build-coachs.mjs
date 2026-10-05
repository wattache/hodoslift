// Génère les pages coach du site vitrine à partir de `coachs.js` (FRE-27).
//
// POURQUOI GÉNÉRER plutôt qu'injecter en JS au chargement : ces pages existent
// pour être ENVOYÉES — en story, en DM, en bio Instagram. Les robots d'aperçu
// (WhatsApp, Facebook, iMessage, Slack) lisent le HTML brut et n'exécutent PAS
// le JavaScript : une page peuplée côté client afficherait le même titre et la
// même image pour les trois coachs. Chaque page porte donc ses propres balises
// og: dans le HTML livré.
//
// Aucune dépendance, aucun framework : `make landing` lance ce script puis
// déploie. Ajouter un coach = une entrée dans coachs.js, rien d'autre.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUES } from './langues.js';

const DIR = dirname(fileURLToPath(import.meta.url));
// Le seau PUBLIC de Scaleway, où brokkr téléverse (`api-python/app/personnes/storage.py`).
const BUCKET = 'https://french-forge-coachs-public.s3.fr-par.scw.cloud';
const SITE = 'https://french-forge.com';
const APP = 'https://trainer.french-forge.com';
// Route PUBLIQUE de brokkr (FRE-30) : le coach édite son profil depuis l'app et
// la page reflète le changement sans rebuild. Même URL que VITE_BROKKR_URL du
// front — en dur ici parce que la landing est servie telle quelle, sans build.
const BROKKR = 'https://brokkr-516415373440.europe-west4.run.app';

// coachs.js pose `window.COACHS` — on lui fournit un `window` et on l'évalue.
const sandbox = { window: {} };
new Function('window', readFileSync(join(DIR, 'coachs.js'), 'utf8'))(sandbox.window);
const COACHS = sandbox.window.COACHS ?? [];

/** Les bios sont saisies à la main : tout texte qui entre dans le HTML est
 *  échappé, sans exception. Une apostrophe typographique ou un « & » dans un
 *  nom de club suffirait à casser la page. */
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** URL YouTube (watch, youtu.be, shorts) → identifiant de la vidéo.
 *  Retourne null si ce n'est pas du YouTube : la page n'affiche alors pas de
 *  lecteur plutôt que d'intégrer une iframe morte. */
/** Code pays ISO (« FR », « PL ») → emoji drapeau, par décalage vers les
 *  « regional indicator symbols ». Évite d'embarquer 250 images de drapeaux
 *  pour une information qui tient en deux lettres dans `coachs.js`.
 *  France par défaut : c'est le cas de tous les athlètes du club aujourd'hui. */
function drapeau(code = 'FR') {
  const c = String(code).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Mouvements affichés, dans l'ordre du plateau. Les clés reprennent celles de
 *  `currentOneRM` côté brokkr (`muscleUp`, `pullUp`, `chinUp`, `dip`, `squat`,
 *  `benchPress`, `deadlift`) : le jour où ces chiffres viendront de l'API plutôt
 *  que de coachs.js, il n'y aura qu'à changer la SOURCE, pas cet affichage.
 *
 *  ⚠️ LES SEPT, DEPUIS FRE-147, et rien ne change à l'écran aujourd'hui : seuls
 *  les mouvements RENSEIGNÉS sortent (le filtre `kg > 0` plus bas), et aucun
 *  coach n'a encore saisi son développé couché. C'est la CAPACITÉ qui manquait
 *  — sans ces deux lignes, un coach l'aurait saisi dans l'app et sa page
 *  vitrine ne l'aurait jamais montré, sans rien pour le lui dire. */
const MOUVEMENTS = [
  ['muscleUp', 'Muscle up'],
  ['pullUp', 'Pull up'],
  ['chinUp', 'Chin up'],
  ['dip', 'Dips'],
  ['squat', 'Squat'],
  ['benchPress', 'Bench press'],
  ['deadlift', 'Deadlift'],
];

function youtubeId(url = '') {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}

const CSS = `
  :root {
    --bg:#0b0b0c; --bg-card:#18181a; --border:#2a2a2e; --text:#f1f1f3;
    --text-muted:#888; --accent:#d4a843; --accent-dim:rgba(212,168,67,.15);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .container{max-width:1100px;margin:0 auto;padding:0 24px}
  nav{padding:20px 0;border-bottom:1px solid var(--border);position:sticky;top:0;background:rgba(11,11,12,.85);backdrop-filter:blur(10px);z-index:10}
  nav .container{display:flex;align-items:center;justify-content:space-between}
  .brand{display:inline-flex;align-items:center;gap:10px;text-decoration:none;color:var(--text)}
  .brand-logo{width:36px;height:36px;background:var(--accent);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:20px;color:#1a1a1a}
  .brand-name{font-weight:700;letter-spacing:-.02em}
  .brand-name span{color:var(--accent)}
  .nav-cta{color:var(--text);text-decoration:none;border:1px solid var(--border);padding:8px 16px;border-radius:8px;font-size:14px}
  .nav-cta:hover{border-color:var(--accent)}
  a{color:var(--accent)}
  main{padding:56px 0 80px}
  .back{display:inline-block;color:var(--text-muted);text-decoration:none;font-size:14px;margin-bottom:28px}
  .back:hover{color:var(--text)}
  .hero{display:grid;grid-template-columns:240px 1fr;gap:40px;align-items:center}
  /* Le CTA est la raison d'être de la page : un athlète arrive d'une bio
     Instagram, lit deux lignes, et doit pouvoir écrire au coach sans chercher.
     Doré plein — c'est le seul bouton primaire de la page. */
  .cta{display:inline-flex;align-items:center;gap:8px;background:var(--accent);color:#1a1a1a;
    padding:13px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;
    box-shadow:0 4px 24px rgba(212,168,67,.22);transition:transform .15s,box-shadow .15s}
  .cta:hover{transform:translateY(-2px);box-shadow:0 8px 32px rgba(212,168,67,.32)}
  .cta-zone{margin-top:22px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
  /* Rappel en fin de page : c'est APRÈS les témoignages que la décision se
     prend, et l'athlète ne devrait pas avoir à remonter pour agir. */
  .outro{margin-top:56px;padding:36px 24px;text-align:center;
    background:var(--bg-card);border:1px solid var(--border);border-radius:18px}
  .outro h3{font-size:22px;letter-spacing:-.02em;margin-bottom:8px}
  .outro p{color:var(--text-muted);margin-bottom:22px}
  /* Records — l'argument le plus court d'un coach de force : un chiffre qui se
     lit sans phrase. Grille auto-fit pour rester lisible avec 2 comme 5
     mouvements renseignés. */
  .records{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px}
  .record{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;
    padding:20px 18px;text-align:center}
  .record .kg{font-size:30px;font-weight:800;letter-spacing:-.03em;color:var(--accent);
    font-variant-numeric:tabular-nums}
  .record .kg small{font-size:15px;font-weight:600;margin-left:2px}
  .record .mv{margin-top:6px;font-size:11px;font-weight:700;text-transform:uppercase;
    letter-spacing:.1em;color:var(--text-muted)}
  .portrait{width:100%;aspect-ratio:1;border-radius:20px;background:radial-gradient(circle at 50% 30%,var(--accent-dim),transparent 70%),var(--bg-card);object-fit:contain;border:1px solid var(--border)}
  h1{font-size:40px;line-height:1.1;letter-spacing:-.03em}
  .accroche{color:var(--accent);font-size:15px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px}
  .bio{color:var(--text-muted);font-size:17px;margin-top:16px;max-width:52ch;white-space:pre-line}
  .langues{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap}
  .langue{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);
    border-radius:999px;padding:5px 12px;font-size:13px;color:var(--text-muted)}
  .socials{margin-top:20px;display:flex;gap:12px;flex-wrap:wrap}
  .socials a{border:1px solid var(--border);padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px}
  .socials a:hover{border-color:var(--accent)}
  h2{font-size:22px;margin:56px 0 20px;letter-spacing:-.02em}
  .video{position:relative;width:100%;aspect-ratio:16/9;border-radius:14px;overflow:hidden;border:1px solid var(--border)}
  .video iframe{width:100%;height:100%;border:0}
  /* Témoignages façon story : la photo de l'athlète EST la carte, la citation
     se pose dessus. Défilement horizontal en CSS pur (scroll-snap) — un
     carrousel en JS demanderait des boutons, un état, une gestion tactile, pour
     un geste que le navigateur fait déjà nativement. */
  .temoignages{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;
    padding:4px 24px 20px;margin:0 -24px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
  .temoignages::-webkit-scrollbar{display:none}
  .temoignage{position:relative;flex:0 0 min(330px,78vw);aspect-ratio:9/16;scroll-snap-align:center;
    border-radius:18px;overflow:hidden;border:1px solid var(--border);
    background:radial-gradient(circle at 50% 42%,#22222a,#0e0e11 72%);
    display:flex;flex-direction:column;justify-content:space-between;margin:0}
  /* contain et NON cover : l'athlète est le sujet, un recadrage automatique lui
     coupe la tête une fois sur deux. La photo s'inscrit donc en entier, posée
     sur le fond plutôt qu'elle ne le remplit. (Pas de backtick ici : ce bloc
     est un template literal.) */
  .temoignage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
    object-position:50% 44%;z-index:0}
  /* Deux voiles : le haut pour détacher le nom, le bas pour la citation. Sans
     eux, un t-shirt clair rendrait le texte blanc illisible. */
  .temoignage .veil{position:absolute;inset:0;z-index:1;background:
    linear-gradient(to bottom,rgba(0,0,0,.72) 0%,rgba(0,0,0,.18) 22%,transparent 38%),
    linear-gradient(to top,rgba(0,0,0,.93) 0%,rgba(0,0,0,.78) 32%,rgba(0,0,0,.12) 62%,transparent 78%)}
  .temoignage .top{position:relative;z-index:2;padding:18px 20px 0;display:flex;
    align-items:center;justify-content:center;gap:10px}
  .temoignage .nom{font-size:30px;font-weight:800;letter-spacing:-.02em;color:#fff;
    text-shadow:0 2px 18px rgba(0,0,0,.7)}
  .temoignage .flag{font-size:22px;line-height:1}
  .temoignage .quote{position:relative;z-index:2;padding:0 20px 22px}
  .temoignage p{font-size:15px;line-height:1.5;color:#fff;text-align:center;
    text-shadow:0 1px 14px rgba(0,0,0,.75)}
  .hint{color:var(--text-muted);font-size:13px;margin-top:-8px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
  .card{background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:26px 24px;
    text-decoration:none;color:var(--text);display:block;text-align:center;
    transition:border-color .15s,transform .15s}
  .card:hover{border-color:var(--accent);transform:translateY(-2px)}
  .card img{width:112px;height:112px;border-radius:50%;object-fit:cover;
    background:radial-gradient(circle at 50% 35%,var(--accent-dim),transparent 70%),var(--bg);
    margin:0 auto 16px;display:block}
  .card h3{font-size:19px;letter-spacing:-.02em}
  /* Un nom et trois mots ne donnent aucune raison de cliquer : la bio fait le
     travail d'accroche que la carte ne faisait pas. */
  .card .card-bio{color:var(--text-muted);font-size:14px;line-height:1.5;margin-top:10px;white-space:pre-line}
  .card .more{display:inline-block;margin-top:14px;color:var(--accent);font-size:14px;font-weight:600}
  footer.site{border-top:1px solid var(--border);padding:32px 0;color:var(--text-muted);font-size:14px;text-align:center}
  @media (max-width:720px){.hero{grid-template-columns:1fr;gap:24px}h1{font-size:32px}}
`;

const shell = ({ title, description, image, url, body, script = '' }) => `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="${esc(description)}" />
<meta name="theme-color" content="#0b0b0c" />
<link rel="canonical" href="${url}" />

<meta property="og:type" content="profile" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${url}" />
<meta property="og:locale" content="fr_FR" />
${image ? `<meta property="og:image" content="${image}" />` : ''}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
${image ? `<meta name="twitter:image" content="${image}" />` : ''}

<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='12' fill='%23d4a843'/%3E%3C/svg%3E" />
<style>${CSS}</style>
</head>
<body>

<nav>
  <div class="container">
    <a href="${SITE}" class="brand">
      <div class="brand-logo">⚒</div>
      <div class="brand-name">French Forge <span>Trainer</span></div>
    </a>
    <a href="${APP}" class="nav-cta">Ouvrir l'app</a>
  </div>
</nav>

<main class="container">
${body}
</main>

<footer class="site">
  <div class="container">
    <strong>French Forge Trainer</strong> · <a href="${APP}">trainer.french-forge.com</a><br>
    <small style="opacity:.6">© 2026 French Forge · Tous droits réservés</small>
  </div>
</footer>

${script}
</body>
</html>
`;

/** Rafraîchissement au RUNTIME du profil coach (FRE-30).
 *
 *  Le HTML livré porte déjà le contenu figé au build — c'est lui que lisent les
 *  robots d'aperçu (WhatsApp, iMessage), qui n'exécutent pas de JavaScript, et
 *  c'est lui qui reste affiché si brokkr est indisponible. Ce script ne fait que
 *  REMPLACER par plus frais, jamais vider : un coach qui édite sa bio la voit en
 *  ligne sans rebuild, et une panne d'API ne transforme pas la page en coquille.
 *
 *  Il n'écrit donc un champ que si la réponse en contient un — d'où les tests
 *  sur `!= null` plutôt qu'un simple `if (data.bio)`, qui laisserait passer une
 *  chaîne vide et effacerait le texte de secours. */
/** Le rendu des langues, ÉCRIT UNE FOIS et injecté dans les DEUX scripts.
 *
 *  ⚠️ IL N'EXISTAIT QUE DANS `scriptCartes` (la liste /coachs). La page d'UN
 *  coach émettait pourtant le conteneur `data-live="langues"` — mais rien ne le
 *  remplissait, donc il restait `hidden` à jamais. Signalé le 17/08 :
 *  french-forge.com/coachs/maxime-nowak n'affichait aucune langue alors que
 *  l'API en renvoyait trois.
 *
 *  Le conteneur d'un côté, l'hydratation de l'autre : c'est la même faute que
 *  `lib/variantes.ts` documente côté app — une règle recopiée dans deux rendus
 *  est une règle oubliée dans l'un des deux. D'où la factorisation plutôt qu'un
 *  troisième exemplaire.
 *
 *  `racine` diffère entre les deux appelants : `document` sur la page d'un
 *  coach (un seul profil), la carte courante sur la liste (plusieurs). */
const rendreLangues = (racine) => `
      var zl = ${racine}.querySelector('[data-live="langues"]');
      if (zl && d.langues && d.langues.length) {
        var noms = ${JSON.stringify(Object.fromEntries(LANGUES.map(l => [l.code, l.drapeau + ' ' + l.nom])))};
        zl.innerHTML = d.langues.map(function (c) {
          return '<span class="langue">' + (noms[c] || c) + '</span>';
        }).join('');
        zl.hidden = false;
      }`;


function scriptLive(slug) {
  return `<script>
(function () {
  var URL_ = ${JSON.stringify(BROKKR + '/coach-profiles/' + slug)};
  var q = function (n) { return document.querySelector('[data-live="' + n + '"]'); };

  fetch(URL_, { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return; // 404 ou panne : le contenu du build reste en place

      var poser = function (nom, valeur) {
        var el = q(nom);
        if (!el || valeur == null || String(valeur).trim() === '') return;
        el.textContent = valeur;
        el.hidden = false;
      };
      poser('accroche', d.accroche);
      poser('bio', d.bio);
${rendreLangues("document")}

      // La photo garde le MÊME nom d'objet à chaque envoi : sans casse-cache, le
      // navigateur resservirait l'ancienne pendant des heures.
      var img = q('photo');
      if (img && d.photoUrl) img.src = d.photoUrl + '?v=' + Date.now();

      var cta = q('contact');
      if (cta && d.instagram) cta.href = d.instagram;

      // Records : un 0 n'est pas un record, c'est un chiffre non communiqué —
      // l'afficher dirait le contraire de la vérité sur le coach.
      var libelles = ${JSON.stringify(MOUVEMENTS)};
      var zone = q('records'), section = q('records-section');
      if (zone && section && d.oneRm) {
        var html = libelles.filter(function (m) { return Number(d.oneRm[m[0]]) > 0; })
          .map(function (m) {
            return '<div class="record"><div class="kg">' + Number(d.oneRm[m[0]]) +
              '<small>kg</small></div><div class="mv">' + m[1] + '</div></div>';
          }).join('');
        if (html) { zone.innerHTML = html; section.hidden = false; }
      }
    })
    .catch(function () { /* hors-ligne : le HTML du build fait le travail */ });
})();
</scr` + `ipt>`;
}

function pageCoach(c) {
  const photo = `${BUCKET}/${c.slug}/profil.png`;
  const vid = youtubeId(c.video);
  const description = c.bio || `${c.nom}, coach French Forge.`;

  const temoignages = (c.temoignages ?? []).filter(t => t && t.texte);
  const prenom = c.nom.split(' ')[0];

  // Seuls les mouvements RENSEIGNÉS sortent : une case vide à 0 kg dirait le
  // contraire de la vérité sur un coach qui ne l'a simplement pas communiqué.
  const records = MOUVEMENTS
    .map(([cle, label]) => [cle, label, Number(c.records?.[cle])])
    .filter(([, , kg]) => Number.isFinite(kg) && kg > 0);

  // Le contact passe par Instagram (décision de William, 2026-08-12) : c'est là
  // que les athlètes écrivent déjà. Sans lien renseigné, on ne laisse pas la
  // page sans issue — repli sur l'app, qui est l'autre porte d'entrée.
  const contact = c.instagram
    ? `<a class="cta" href="${esc(c.instagram)}" rel="noopener" data-live="contact">Être coaché par ${esc(prenom)} →</a>`
    : `<a class="cta" href="${APP}" data-live="contact">Découvrir l'app →</a>`;

  const socials = [
    c.video && !vid && `<a href="${esc(c.video)}" rel="noopener">Voir la vidéo</a>`,
  ].filter(Boolean).join('\n      ');

  return shell({
    script: scriptLive(c.slug),
    title: `${c.nom} — Coach French Forge`,
    description,
    image: photo,
    url: `${SITE}/coachs/${c.slug}`,
    body: `  <a href="${SITE}/coachs" class="back">← Tous les coachs</a>

  <div class="hero">
    <img class="portrait" src="${photo}" alt="${esc(c.nom)}" loading="eager" data-live="photo" />
    <div>
      <div class="accroche"${c.accroche ? '' : ' hidden'} data-live="accroche">${esc(c.accroche ?? '')}</div>
      <h1>${esc(c.nom)}</h1>
      <p class="bio"${c.bio ? '' : ' hidden'} data-live="bio">${esc(c.bio ?? '')}</p>
      <div class="langues" hidden data-live="langues"></div>
      <div class="cta-zone">
        ${contact}
        ${socials}
      </div>
    </div>
  </div>
${vid ? `
  <h2>En vidéo</h2>
  <div class="video">
    <iframe src="https://www.youtube-nocookie.com/embed/${vid}" title="${esc(c.nom)}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
  </div>` : ''}

  <div data-live="records-section"${records.length ? '' : ' hidden'}>
  <h2>Ses records</h2>
  <div class="records" data-live="records">
${records.map(([, label, kg]) => `    <div class="record">
      <div class="kg">${kg}<small>kg</small></div>
      <div class="mv">${label}</div>
    </div>`).join('\n')}
  </div>
  </div>
${temoignages.length ? `
  <h2>Ils s'entraînent avec ${esc(prenom)}</h2>
  ${temoignages.length > 1 ? `<p class="hint">Fais défiler →</p>` : ''}
  <div class="temoignages">
${temoignages.map(t => `    <blockquote class="temoignage">
      ${t.photo ? `<img src="${BUCKET}/${c.slug}/temoignages/${esc(t.photo)}" alt="${esc(t.athlete || '')}" loading="lazy" />` : ''}
      <div class="veil"></div>
      <div class="top">
        ${t.athlete ? `<span class="nom">${esc(t.athlete)}</span>` : ''}
        <span class="flag" role="img" aria-label="${esc(t.pays || 'FR')}">${drapeau(t.pays)}</span>
      </div>
      <div class="quote">
        <p>« ${esc(t.texte)} »</p>
      </div>
    </blockquote>`).join('\n')}
  </div>` : ''}

  <div class="outro">
    <h3>Envie de t'entraîner avec ${esc(prenom)} ?</h3>
    <p>Écris-lui, il répond lui-même.</p>
    ${contact}
  </div>
`,
  });
}

/** Rafraîchit toutes les cartes coach d'une page depuis brokkr.
 *
 *  UN SEUL script pour les TROIS surfaces qui affichent du contenu coach :
 *  l'accueil, la liste /coachs, et chaque fiche. Elles ont divergé une fois —
 *  /coachs a été oubliée et servait encore le texte figé de coachs.js pendant
 *  que les deux autres lisaient l'API. Une fonction, trois appels.
 *
 *  Marche par convention : chaque carte porte `data-coach="<slug>"` et ses
 *  champs `data-live="accroche|bio|photo"`. Le HTML livré reste la version de
 *  secours — on ne REMPLACE que ce que la réponse contient vraiment. */
function scriptCartes() {
  return `<script>
(function () {
  document.querySelectorAll('[data-coach]').forEach(function (carte) {
    fetch(${JSON.stringify(BROKKR)} + '/coach-profiles/' + carte.dataset.coach)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var poser = function (nom, valeur) {
          var el = carte.querySelector('[data-live="' + nom + '"]');
          if (!el || valeur == null || String(valeur).trim() === '') return;
          el.textContent = valeur;
          el.hidden = false;
        };
        poser('accroche', d.accroche);
        poser('bio', d.bio);

        ${rendreLangues("carte")}
        var img = carte.querySelector('[data-live="photo"]');
        if (img && d.photoUrl) img.src = d.photoUrl + '?v=' + Date.now();
      })
      .catch(function () { /* le HTML du build fait le travail */ });
  });
})();
</scr` + `ipt>`;
}

function pageIndex(coachs) {
  return shell({
    script: scriptCartes(),
    title: 'Les coachs — French Forge',
    description: 'Les coachs French Forge : streetlifting, force, préparation aux compétitions.',
    image: coachs[0] ? `${BUCKET}/${coachs[0].slug}/profil.png` : null,
    url: `${SITE}/coachs`,
    body: `  <h1>Les coachs</h1>
  <p class="bio">Chacun son approche, la même exigence sur les détails.</p>

  <div class="cards" style="margin-top:36px">
${coachs.map(c => `    <a class="card" href="${SITE}/coachs/${c.slug}" data-coach="${c.slug}">
      <img src="${BUCKET}/${c.slug}/profil.png" alt="" loading="lazy" data-live="photo" />
      <h3>${esc(c.nom)}</h3>
      <div class="accroche" style="margin:8px 0 0"${c.accroche ? '' : ' hidden'} data-live="accroche">${esc(c.accroche ?? '')}</div>
      <p class="card-bio"${c.bio ? '' : ' hidden'} data-live="bio">${esc(c.bio ?? '')}</p>
      <!-- CE CONTENEUR MANQUAIT, et scriptCartes hydratait donc du vide.
           Symetrique exact du defaut de la page d'un coach, qui avait le
           conteneur sans l'hydratation : aucune des deux ne montrait de langue.
           Centre ici, car une carte l'est, la ou la page d'un coach aligne a
           gauche. -->
      <div class="langues" style="margin-top:12px;justify-content:center" hidden data-live="langues"></div>
      <span class="more">Voir son profil →</span>
    </a>`).join('\n')}
  </div>
`,
  });
}

const out = join(DIR, 'coachs');
mkdirSync(out, { recursive: true });

// `slug` sert de nom de fichier ET de dossier dans le bucket : un slug fantaisiste
// écrirait hors du dossier de sortie. On refuse plutôt que d'écrire n'importe où.
for (const c of COACHS) {
  if (!/^[a-z0-9-]+$/.test(c.slug ?? '')) {
    throw new Error(`slug invalide : ${JSON.stringify(c.slug)} (a-z, 0-9 et tirets)`);
  }
  writeFileSync(join(out, `${c.slug}.html`), pageCoach(c));
  console.log(`  coachs/${c.slug}.html`);
}
writeFileSync(join(out, 'index.html'), pageIndex(COACHS));
console.log(`  coachs/index.html  (${COACHS.length} coachs)`);

/** Cartes coachs de la PAGE D'ACCUEIL, injectées entre les marqueurs.
 *
 *  Elles étaient recopiées à la main dans index.html — et avaient déjà divergé de
 *  coachs.js (une bio corrigée à la source restait fausse sur l'accueil). Deux
 *  copies d'un même texte finissent toujours par se contredire ; celle-ci est
 *  désormais dérivée, comme les pages elles-mêmes. */
function injecterAccueil() {
  const chemin = join(DIR, 'index.html');
  const html = readFileSync(chemin, 'utf8');
  const DEBUT = '<!-- COACHS:DEBUT';
  const FIN = '<!-- COACHS:FIN -->';

  const i = html.indexOf(DEBUT);
  const j = html.indexOf(FIN);
  if (i < 0 || j < 0) {
    // Marqueurs disparus (page réécrite ?) : on le DIT plutôt que de laisser
    // l'accueil afficher silencieusement des bios périmées.
    console.warn('  ⚠ index.html : marqueurs COACHS absents — cartes non régénérées');
    return;
  }

  const cartes = COACHS.map(c => `      <a class="coach-card" href="/coachs/${c.slug}" data-coach="${c.slug}">
        <img src="${BUCKET}/${c.slug}/profil.png" alt="" loading="lazy" data-live="photo" />
        <h3>${esc(c.nom)}</h3>
        <div class="coach-role"${c.accroche ? '' : ' hidden'} data-live="accroche">${esc(c.accroche ?? '')}</div>
        <p class="coach-bio"${c.bio ? '' : ' hidden'} data-live="bio">${esc(c.bio ?? '')}</p>
        <span class="coach-more">Voir son profil →</span>
      </a>`).join('\n');

  const script = scriptCartes();

  const remplacement = `${DEBUT} — généré par build-coachs.mjs depuis coachs.js, ne pas éditer à la main -->
    <div class="coach-grid">
${cartes}
    </div>
    ${script}
    ${FIN}`;

  writeFileSync(chemin, html.slice(0, i) + remplacement + html.slice(j + FIN.length));
  console.log(`  index.html         (${COACHS.length} cartes)`);
}

injecterAccueil();
