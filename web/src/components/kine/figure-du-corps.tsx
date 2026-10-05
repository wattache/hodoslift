import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  CADRE, cleDuNom, codeDeZone, COTES_DU_TRACE, coteDuCorps, estTouchable, slugDuTrace,
  zonesDeLaVue, type Cote, type Vue,
} from '@/lib/anatomie/zones';
import { couleurDIntensite, GRIS_LIBRE, OR_SELECTION } from '@/lib/douleurs/intensite';
import { cn } from '@/lib/utils';

type Props = {
  /** Les zones déjà retenues, en codes (`chest:gauche`). */
  choisies: readonly string[];
  /** CELLES QUI PORTENT DÉJÀ UNE DOULEUR VIVANTE, et sa dernière intensité.
   *
   *  ⚠️ UN TROISIÈME ÉTAT, PAS UNE VARIANTE DE `choisies` : les toucher ouvre la
   *  douleur existante au lieu d'en créer une. Et leur couleur est celle de
   *  l'intensité, pas l'or de la sélection — sinon la figure dirait « j'ai
   *  choisi ça » à propos de ce qu'on n'a pas choisi.
   *
   *  ⚠️ `null` EN VALEUR VEUT DIRE « SUIVIE MAIS JAMAIS NOTÉE ». Le mettre à 0
   *  la peindrait en vert, c'est-à-dire « plus mal » — une réponse que
   *  personne n'a donnée. C'est la confusion `''`/NULL du projet, en couleur. */
  suivies?: Readonly<Record<string, number | null>>;
  /** ⚠️ ABSENT = LECTURE SEULE, et c'est la règle d'affordance du projet : le
   *  staff voit où son athlète a mal, mais brokkr n'accepte la déclaration
   *  qu'en `owner`. Un bouton qui ne fait rien trompe aussi la tabulation et le
   *  lecteur d'écran. */
  onChoisir?: (code: string) => void;
  /** Ce qui reste affiché sous la figure quand la souris s'en va : le muscle
   *  retenu. Sans lui, lâcher la souris efface la réponse qu'on vient d'avoir. */
  nomChoisi?: string | null;
  /** ⚠️ LA FIGURE RAPETISSE QUAND LA FEUILLE MONTE, et seulement sur téléphone.
   *  Sans ça, une douleur au mollet se choisit derrière le formulaire : on
   *  touche à l'aveugle, ou on referme pour voir. Sur grand écran le formulaire
   *  prend la colonne de droite et ne recouvre rien. */
  compacte?: boolean;
  className?: string;
};

/** LA FIGURE OÙ L'ON MONTRE SA DOULEUR — FRE-195.
 *
 *  L'athlète touche l'endroit qui lui fait mal ; il n'a pas à le nommer. C'est
 *  toute la raison d'être de cet écran : les huit douleurs signalées jusqu'ici
 *  l'étaient en texte libre, et sept sur huit précisaient un côté qu'aucune
 *  requête ne pouvait relire.
 *
 *  ⚠️ CE QUI SORT D'ICI EST UN CÔTÉ DE CORPS, PAS UN CÔTÉ D'ÉCRAN. La
 *  conversion vit dans `zones.ts` — voir `coteDuCorps`, et la spec qui garde le
 *  miroir face/dos.
 *
 *  ⚠️ ET ON PEUT Y ARRIVER SANS LA VUE. Une figure cliquable seule est
 *  inutilisable au lecteur d'écran : chaque zone est un bouton nommé, atteint
 *  par la tabulation, et la liste sous la figure dit ce qui est retenu. */
export function FigureDuCorps({ choisies, suivies = {}, onChoisir, nomChoisi, compacte, className }: Props) {
  const { t } = useTranslation();
  const [vue, setVue] = useState<Vue>('face');
  const [zoom, setZoom] = useState(1);
  /** ⚠️ LE SURVOL SE LIT AUSSI AU CLAVIER (`onFocus`). Un nom qui n'apparaît
   *  qu'à la souris laisse dehors qui tabule — et le tactile, où le survol
   *  n'existe pas, garde la figure utilisable parce que TOUCHER dit déjà où
   *  l'on est. */
  const [survole, setSurvole] = useState<{ nom: string; x: number; y: number } | null>(null);
  const idZoom = useId();
  const cadre = useRef<HTMLDivElement>(null);

  /** ⚠️ RAPETISSER NE SUFFIT PAS : LA FIGURE DOIT REMONTER. Même réduite, elle
   *  reste sous la feuille si la page n'a pas bougé — l'en-tête de l'écran (la
   *  fiche de l'athlète, les onglets) occupe déjà 330 px, et il n'est pas à
   *  nous. On amène donc le cadre en haut, où la place suffit.
   *
   *  ⚠️ `useLayoutEffect`, ET PAS `useEffect` : la feuille et la hauteur
   *  réduite sont posées par le MÊME rendu. Lancé après la peinture, le
   *  défilement mesurait une page qui n'avait pas encore rétréci et n'allait
   *  nulle part — mesuré, `scrollY` restait à 0. */
  useLayoutEffect(() => {
    if (compacte) cadre.current?.scrollIntoView({ block: 'start' });
  }, [compacte]);

  const retenues = new Set(choisies);

  const nom = (slug: string, cote: Cote | null) =>
    cote ? `${t(cleDuNom(slug), slug)} ${t(`anatomie.${cote}`)}` : t(cleDuNom(slug), slug);

  const planche = (v: Vue) => (
    <svg viewBox={CADRE[v]} role="group" aria-label={t(`anatomie.vue.${v}`)}
         style={{
           height: `${zoom * 100}%`, width: 'auto', display: 'block', margin: '0 auto',
           // ⚠️ LA LARGEUR BORNE LA HAUTEUR, sinon la figure déborde de sa
           // colonne. Deux corps calés sur 640 px de haut font 320 px de large
           // chacun : dans une colonne de 410, les bras passaient hors cadre et
           // une barre de défilement horizontale apparaissait. Au zoom, la
           // borne s'ouvre d'autant — c'est là qu'on VEUT déborder.
           maxWidth: `${zoom * 100}%`,
         }}>
          {zonesDeLaVue(v).map(zone => (
            <g key={zone.slug}>
              {COTES_DU_TRACE.map(ecran => {
                const traces = zone.path[ecran];
                if (!traces?.length) return null;

                // ⚠️ LE DÉCOR SE DESSINE, IL NE SE TOUCHE PAS. La tête et les
                // cheveux font la silhouette : sans eux le corps est décapité,
                // et cliquables ils proposeraient une réponse qui n'en est pas.
                if (!estTouchable(zone)) {
                  return (
                    <g key={ecran} aria-hidden style={{ fill: 'currentColor' }} className="opacity-40">
                      {traces.map((d, i) => <path key={i} d={d} />)}
                    </g>
                  );
                }

                const cote = coteDuCorps(v, ecran);
                // ⚠️ UN BOUTON PAR TRACÉ, PLUS UN PAR ZONE. C'est tout le sujet :
                // les trois tracés de l'avant-bras répondaient « Avant-bras »,
                // dont le brachio-radial — le muscle qu'un athlète a nommé dans
                // sa saisie. Ceux que `FAISCEAUX` ne détaille pas retombent sur
                // le slug de leur zone, et restent donc groupés.
                return traces.map((d, i) => {
                  const slug = slugDuTrace(v, zone, ecran, i);
                  const code = codeDeZone(slug, cote);
                  const prise = retenues.has(code);
                  const suivie = code in suivies;
                  const intensite = suivies[code];
                  const interactif = Boolean(onChoisir);
                  const libelle = suivie
                    ? `${nom(slug, cote)} — ${t('douleurs.dejaSuivie')}`
                    : nom(slug, cote);
                  return (
                  <g key={`${ecran}-${i}`}
                     role={interactif ? 'button' : 'img'} tabIndex={interactif ? 0 : undefined}
                     // ⚠️ LA COULEUR NE SUFFIT PAS À DIRE « DÉJÀ SUIVIE ». Elle ne
                     // dit rien au lecteur d'écran, et rien non plus à qui ne
                     // distingue pas deux ors. Le nom le porte aussi.
                     aria-pressed={interactif ? prise : undefined}
                     aria-label={libelle}
                     onClick={onChoisir && (() => onChoisir(code))}
                     onKeyDown={onChoisir && (e => {
                       if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoisir(code); }
                     })}
                     onMouseEnter={e => setSurvole({ nom: libelle, x: e.clientX, y: e.clientY })}
                     onMouseMove={e => setSurvole({ nom: libelle, x: e.clientX, y: e.clientY })}
                     onMouseLeave={() => setSurvole(null)}
                     onFocus={e => {
                       // Au clavier il n'y a pas de curseur : l'infobulle se
                       // pose sur le muscle lui-même.
                       const r = (e.target as SVGGElement).getBoundingClientRect();
                       setSurvole({ nom: libelle, x: r.x + r.width / 2, y: r.y });
                     }}
                     onBlur={() => setSurvole(null)}
                     className={cn('outline-none focus-visible:opacity-80',
                                   interactif && 'cursor-pointer')}
                     style={{
                       // ⚠️ TROIS ÉTATS, TROIS COULEURS — et l'opacité ne suffit
                       // pas à les dire : un même or à deux opacités se lit
                       // comme un seul état plus ou moins sûr, pas comme deux
                       // faits différents.
                       fill: prise ? OR_SELECTION
                         : intensite != null ? couleurDIntensite(intensite)
                         : suivie ? OR_SELECTION
                         : GRIS_LIBRE,
                       opacity: prise ? 1 : suivie ? 0.6 : 0.72,
                     }}>
                    {/* ⚠️ LE CONTOUR TRANSPARENT ÉLARGIT LA PRISE. Un doigt vise
                        moins bien qu'un curseur, et un muscle fin — l'anconé, le
                        droit interne — serait autrement presque intouchable.
                        ⚠️ TROIS ÉTATS, TROIS OPACITÉS. « Déjà suivie » se voit
                        sans se confondre avec « je viens de la choisir » : même
                        or, à mi-teinte. */}
                    <path d={d} stroke="transparent" strokeWidth={14}
                          className="transition-opacity hover:opacity-100" />
                  </g>
                  );
                });
              })}
            </g>
          ))}
    </svg>
  );


  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-center gap-2">
        {/* ⚠️ CES ONGLETS DISPARAISSENT DÈS QU'IL Y A LA PLACE (`lg`). Au-delà,
            les deux planches sont côte à côte : une douleur au grand dorsal se
            montre sans avoir à deviner qu'elle est « de dos ». En dessous,
            l'écran d'un téléphone ne tient qu'un corps. */}
        <div className="flex items-center gap-2 lg:hidden">
          {(['face', 'dos'] as Vue[]).map(v => (
            <button key={v} type="button" onClick={() => setVue(v)}
                    aria-pressed={vue === v}
                    className={cn('h-11 rounded-lg border px-4 text-sm transition-colors',
                      vue === v ? 'border-gold text-gold font-semibold' : 'border-border text-muted-foreground')}>
              {t(`anatomie.vue.${v}`)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor={idZoom} className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t('anatomie.zoom')}
          </label>
          {/* ⚠️ LE ZOOM VA JUSQU'À ×4, ET C'EST MESURÉ, PAS CHOISI. Au grain du
              muscle, 61 cibles sur 87 passent sous les 44 px du plancher du
              doigt à l'échelle 1 — médiane 27 px, la plus fine à 11. Le zoom
              est la réponse : ×2 en laisse 37, ×3 en laisse 12, ×4 les fait
              toutes passer. S'arrêter à ×3 aurait laissé l'anconé et le droit
              interne intouchables au pouce. */}
          <input id={idZoom} type="range" min="1" max="4" step="0.25" value={zoom}
                 onChange={e => setZoom(Number(e.target.value))}
                 aria-label={t('anatomie.zoom')}
                 className="h-11 w-24 accent-gold" />
        </div>
      </div>

      {/* ⚠️ LA HAUTEUR PILOTE, PAS LA LARGEUR, et c'est ce qui change tout : le
          cadre fait 724 × 1448, soit un corps DEUX FOIS plus haut que large.
          Calée sur la largeur du cadre, la figure faisait le double en hauteur —
          on ouvrait l'écran sur un torse, tête et jambes hors champ, et il
          fallait deviner qu'on pouvait faire défiler pour voir où l'on a mal.
          À `height: 100%`, elle tient ENTIÈRE au zoom 1, et le zoom sert à ce
          pour quoi il est là : viser un muscle fin avec un doigt. */}
      {/* ⚠️ LES LÉGENDES SONT AU-DESSUS DU CADRE, PAS DEDANS. Placées dans la
          colonne, elles retiraient au SVG la hauteur résolue dont son
          `height: %` dépend : il reprenait sa taille intrinsèque et les deux
          corps se chevauchaient. */}
      <div className="hidden justify-center gap-4 lg:flex">
        {(['face', 'dos'] as Vue[]).map(v => (
          <span key={v} className="flex-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
            {t(`anatomie.vue.${v}`)}
          </span>
        ))}
      </div>

      {/* ⚠️ `scroll-mt` PARCE QUE L'EN-TÊTE DE L'APP EST COLLANT : sans elle,
          `scrollIntoView` cale le cadre à zéro et la barre du haut recouvre la
          tête et les trapèzes — des zones qu'on touche. */}
      <div ref={cadre}
           className={cn('scroll-mt-20 overflow-auto rounded-lg border border-border bg-card/40',
                          // ⚠️ LA FIGURE DOIT TENIR AU-DESSUS DE LA FEUILLE, et
                          // c'est la MISE EN PAGE qui le garantit, pas un
                          // défilement qu'on déclencherait après coup : une
                          // douleur au mollet se choisit sur ce qu'on voit.
                          compacte ? 'h-[min(34vh,300px)] lg:h-[min(70vh,640px)]'
                                   : 'h-[min(70vh,640px)]')}>
        <div className="flex h-full items-stretch justify-center gap-4">
          {(['face', 'dos'] as Vue[]).map(v => (
            <div key={v} className={cn('h-full flex-1', v === vue ? 'block' : 'hidden', 'lg:block')}>
              {planche(v)}
            </div>
          ))}
        </div>
      </div>

      {/* ⚠️ UNE LIGNE QUI NE BOUGE PAS, MÊME VIDE (`min-h`). Apparue et disparue
          avec le survol, elle ferait sauter tout ce qui la suit à chaque
          passage de souris — sur une figure qu'on balaie, c'est l'écran entier
          qui tressaute. */}
      {/* ⚠️ EN OR ET EN CAPITALES ESPACÉES, comme la maquette : ce n'est pas
          une légende de plus mais la RÉPONSE à ce qu'on vient de faire — le
          nom de ce qu'on touche, au même endroit à chaque fois. Sa hauteur ne
          bouge pas, même vide, sinon l'écran tressaute à chaque survol. */}
      {/* ⚠️ LES REPÈRES S'INVERSENT ENTRE LES DEUX VUES, et c'est tout leur
          intérêt : de face on regarde quelqu'un, sa droite est à notre gauche ;
          de dos on regarde dans son sens. Sur un seul corps à la fois, sans
          repère, on touche le mauvais côté sans s'en apercevoir — et sept des
          huit douleurs de production précisent un côté. Inutile sur grand
          écran, où les deux planches sont côte à côte et légendées. */}
      <div className="flex items-center justify-between gap-2 lg:justify-center">
        <span aria-hidden className="text-[11px] tracking-[0.2em] text-muted-foreground lg:hidden">
          {vue === 'face' ? t('anatomie.droiteCourt') : t('anatomie.gaucheCourt')}
        </span>
        <p aria-live="polite"
           className="min-h-[1.25rem] flex-1 text-center text-[11px] uppercase tracking-[0.2em] text-gold">
          {survole?.nom ?? nomChoisi ?? ''}
        </p>
        <span aria-hidden className="text-[11px] tracking-[0.2em] text-muted-foreground lg:hidden">
          {vue === 'face' ? t('anatomie.gaucheCourt') : t('anatomie.droiteCourt')}
        </span>
      </div>

      {/* ⚠️ SANS LÉGENDE, LES COULEURS NE DISENT RIEN. Un muscle orange se lit
          « il se passe quelque chose », pas « 4 à 6 sur 10 » — et l'écart entre
          l'or de la sélection et le jaune du palier 1–3 est justement ce qu'il
          faut expliquer une fois. */}
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {[[OR_SELECTION, t('douleurs.legende.selection')],
          [couleurDIntensite(0), '0'],
          [couleurDIntensite(2), '1–3'],
          [couleurDIntensite(5), '4–6'],
          [couleurDIntensite(9), '7–10']].map(([couleur, libelle]) => (
          <li key={libelle} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: couleur }} />
            {libelle}
          </li>
        ))}
      </ul>

      {/* ⚠️ NOTRE INFOBULLE, PAS CELLE DU NAVIGATEUR. Un `<title>` SVG ne coûte
          rien à écrire, mais il attend une seconde avant de s'afficher — un
          délai que rien ne règle, et qui rend la figure pénible dès qu'on la
          balaie pour trouver un muscle. Celle-ci suit le curseur sans attendre.
          `aria-label` reste le nom accessible : cette bulle est `aria-hidden`,
          sinon le lecteur d'écran annoncerait le muscle deux fois.
          ⚠️ ET ELLE NE PREND PAS LE CURSEUR (`pointer-events-none`) : posée
          sous la souris, elle déclencherait le `mouseleave` du muscle qu'elle
          nomme, et clignoterait indéfiniment. */}
      {survole && (
        <div aria-hidden role="presentation"
             className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
             style={{ left: survole.x + 12, top: survole.y - 28 }}>
          {survole.nom}
        </div>
      )}
    </div>
  );
}
