// Contenu des pages coach du site vitrine (FRE-27).
//
// C'EST LE SEUL FICHIER À ÉDITER pour changer une bio, ajouter un témoignage ou
// pointer une nouvelle vidéo — le HTML de la page se génère à partir d'ici.
// Aucune étape de build : on modifie, on lance `make landing`, c'est en ligne.
//
// Les IMAGES ne sont pas ici : elles vivent dans le bucket public GCS
// `french-forge-600-public-media`, à la racine, un dossier par coach. Le `slug`
// ci-dessous EST le nom de ce dossier — le changer casse les images.
//
//   <slug>/profil.png                  la photo du coach, détourée
//   <slug>/temoignages/<fichier>       les portraits des athlètes
//
// Déposer un fichier :
//   gcloud storage cp profil.png \
//       gs://french-forge-600-public-media/aubin-chevillard/profil.png \
//       --cache-control="public, max-age=86400"
//
// Une valeur vide ou absente est simplement ignorée à l'affichage : un coach
// sans vidéo n'aura pas de lecteur, sans témoignage pas de section, sans record
// pas de chiffres. Rien ne casse tant qu'il y a un `nom` et un `slug`.
//
// `records` — 1RM en CHARGE ADDITIONNELLE (kg lestés, hors poids de corps).
// Les clés reprennent celles de `currentOneRM` côté brokkr, pour que ces
// chiffres puissent un jour venir de l'API sans toucher à l'affichage :
//   muscleUp · pullUp · chinUp · dip · squat

window.COACHS = [
  {
    slug: 'aubin-chevillard',
    nom: 'Aubin Chevillard',
    // Une ou deux phrases : ce qu'il coache, pour qui, ce qui le distingue.
    bio: 'Beau gosse de Signes, et six records du monde toujours à son actif.',
    // Facultatif — la ligne sous le nom (« Coach street & force », un palmarès…).
    accroche: 'King of Pull',
    // YouTube uniquement (Instagram n'autorise plus l'intégration simple).
    // Colle l'URL normale : https://www.youtube.com/watch?v=XXXX
    video: '',
    instagram: 'https://www.instagram.com/obin.cd/',
    records: { muscleUp: 47.5, pullUp: 109, chinUp: 0, dip: 160.5, squat: 227.5 },
    temoignages: [
      {
        athlete: 'William',
        texte: 'Douleur à l’épaule que je traînais depuis 4 ans, volatilisée. Je n’ai jamais été aussi fort, jamais progressé aussi vite.',
        photo: 'william.png',
        // Code pays ISO — devient le drapeau à côté du nom. 'FR' si absent.
        pays: 'FR',
      },
    ],
  },
  {
    slug: 'maxime-nowak',
    nom: 'Maxime Nowak',
    bio: 'Franco-polonais, investi.',
    accroche: 'Ave Maria',
    video: '',
    instagram: 'https://www.instagram.com/maximenwk/',
    records: { muscleUp: 0, pullUp: 0, chinUp: 0, dip: 0, squat: 0 },
    temoignages: [],
  },
  {
    slug: 'theo-goutte-toquet',
    nom: 'Théo Goutte-Toquet',
    bio: 'Spécialiste du muscle-up, champion de force traditionnelle bretonne.',
    accroche: 'Transition béton',
    video: '',
    instagram: 'https://www.instagram.com/theo.gtsl/',
    records: { muscleUp: 25, pullUp: 0, chinUp: 0, dip: 183, squat: 250 },
    temoignages: [],
  },
];
