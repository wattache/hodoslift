import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { BilanResultat } from '@/api/types';
import { RESSENTIS, estRenseigne, versNombre, versTexte } from './bilan-mesures';
import { cn } from '@/lib/utils';

/** UNE LIGNE DE TEST du bilan kiné — la brique de saisie, réutilisée par la page
 *  du bilan. Sortie de son écran pour que la liste et le détail n'aient pas à
 *  vivre dans le même fichier : ils n'ont ni la même page, ni la même largeur. */

function ChampMesure({ valeur, unite, onCommit, lecture, placeholder }: {
  valeur: number | null | undefined; unite: string;
  onCommit: (v: number | null) => void; lecture: boolean; placeholder?: string;
}) {
  const { t: traduire } = useTranslation();
  const [brouillon, setBrouillon] = useState<string | null>(null);
  const affiche = brouillon ?? versTexte(valeur);

  if (lecture) {
    return (
      <span className="font-mono text-sm tabular-nums text-foreground">
        {valeur == null ? <span className="text-muted-foreground">{traduire('suiviKine.nonFait')}</span> : `${valeur} ${unite}`}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1">
      <input
        inputMode="decimal"
        value={affiche}
        placeholder={placeholder}
        onChange={e => setBrouillon(e.target.value)}
        onBlur={() => { if (brouillon !== null) { onCommit(versNombre(brouillon)); setBrouillon(null); } }}
        // `h-10` : la cible tactile minimale. Sur un téléphone, un champ de 28 px
        // se rate une fois sur trois — et ce formulaire se remplit debout, en salle.
        className="h-10 w-20 rounded-md border border-border bg-background px-2 text-right font-mono text-sm tabular-nums"
      />
      <span className="text-xs text-muted-foreground">{unite}</span>
    </span>
  );
}

/** LES IMAGES DE DÉMONSTRATION DU TEST (FRE-99).
 *
 *  ⚠️ DES VIGNETTES QUI S'AGRANDISSENT, PAS DES IMAGES EN PLEINE LARGEUR. Un
 *  bilan porte jusqu'à 32 tests, et certains montrent le mouvement en trois
 *  photos : autant d'images déroulées feraient une page qu'on ne parcourt plus,
 *  et noieraient le seul geste utile ici — poser un ressenti. On regarde une
 *  image quand on ne sait pas faire le mouvement, donc rarement et une à la fois.
 *
 *  ⚠️ ET ELLES VIENNENT DE L'INSTANTANÉ DU RÉSULTAT, jamais du modèle courant :
 *  c'est la consigne sous laquelle CE bilan a été passé (§3.1). */
function ImagesDemo({ resultat }: { resultat: BilanResultat }) {
  const { t: traduire } = useTranslation();
  // Laquelle est ouverte — une seule à la fois : deux images agrandies côte à
  // côte reprendraient la place qu'on vient d'économiser.
  const [ouverte, setOuverte] = useState<string | null>(null);

  const medias = resultat.medias;
  if (medias.length === 0) return null;

  const affichables = medias.filter(m => m.url);
  // ⚠️ RATTACHÉES MAIS INAFFICHABLES : on le DIT, au lieu de ne rien montrer.
  // Sans cette ligne, une clé expirée (FRE-104) ressemblerait à « ce test n'a pas
  // d'image » — et personne ne signalerait jamais la panne.
  const manquantes = medias.length - affichables.length;

  return (
    <div className="mt-2 flex flex-col gap-1">
      {affichables.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {affichables.map((m, i) => {
            const grande = ouverte === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setOuverte(grande ? null : m.id)}
                aria-expanded={grande}
                aria-label={traduire('suiviKine.demonstrationN', { n: i + 1, libelle: resultat.testLibelle })}
                className={cn(
                  'block overflow-hidden rounded-md border border-border transition-all hover:border-primary/50',
                  grande && 'w-full',
                )}
              >
                <img
                  src={m.url!}
                  alt={m.legende ?? traduire('suiviKine.demonstrationN', { n: i + 1, libelle: resultat.testLibelle })}
                  loading="lazy"
                  className={cn('object-cover', grande ? 'max-h-80 w-full' : 'h-16 w-24')}
                />
              </button>
            );
          })}
        </div>
      )}
      {manquantes > 0 && (
        <p className="text-[11px] italic text-muted-foreground/70">
          {traduire('suiviKine.imagesIndisponibles', { count: manquantes })}
        </p>
      )}
    </div>
  );
}


/** ⚠️ PLUS DE PROP `test` : LE RÉSULTAT SE SUFFIT. Depuis le moteur, chaque
 *  résultat porte l'INSTANTANÉ de ce qui lui a été demandé — libellé, protocole,
 *  unité, latéralité, charge, angles de vue. L'écran n'a donc plus à joindre un
 *  référentiel, et surtout : il affiche ce qui a été demandé À CE BILAN-LÀ, pas
 *  ce que le modèle dit aujourd'hui. C'est la garantie §3.1 rendue visible. */
export function LigneTest({ resultat, precedent, lecture, vise = false, onEcrire }: {
  resultat: BilanResultat;
  precedent: BilanResultat | undefined;
  lecture: boolean;
  /** Ce test vient d'être visé par « aller au premier non renseigné ». */
  vise?: boolean;
  onEcrire: (valeurs: Partial<BilanResultat>) => void;
}) {
  const { t: traduire } = useTranslation();
  const unite = resultat.mesure === 'reps' ? 'reps' : 's';
  // ⚠️ LA CHARGE EST DÉJÀ CELLE DU BILAN. La copie du modèle l'a pré-remplie à la
  // création ; la saisie la corrige quand la salle n'a pas le bon disque. Il n'y a
  // donc plus de « repli sur la prescrite » à gérer côté écran — une ambiguïté de
  // moins, et c'est cette valeur-là qui décide si deux bilans se comparent.
  const charge = resultat.chargeKg;
  const chargesDifferentes =
    precedent != null && charge != null && precedent.chargeKg != null
    && precedent.chargeKg !== charge;

  // ⚠️ LE MARQUEUR EST CE QUI PERMET DE REPRENDRE. Un bilan se remplit sur
  // plusieurs séances (§5) : sans repère par test, retrouver où l'on s'est arrêté
  // demande de relire les 32 lignes une à une. Le compteur global dit COMBIEN,
  // pas OÙ.
  const renseigne = estRenseigne(resultat);

  return (
    <div
      // L'ancre du bouton « Reprendre ». `scroll-mt` compense l'en-tête collant,
      // sans quoi le test visé se retrouverait DERRIÈRE lui.
      id={`test-${resultat.id}`}
      className={cn(
      'relative scroll-mt-24 border-t border-border/60 py-3 pl-3 first:border-t-0',
      // Un filet doré à gauche plutôt qu'une pastille : il suit toute la hauteur
      // du test, donc se voit même quand la ligne est haute — et il ne prend
      // aucune place en largeur, ce qui compte sur 375 px.
      renseigne && 'before:absolute before:bottom-3 before:left-0 before:top-3 '
        + 'before:w-0.5 before:rounded-full before:bg-primary',
      // ⚠️ CE QUI REND LE SAUT PERCEPTIBLE. Viser un test DÉJÀ visible ne déplace
      // rien : le bouton semblait alors ne rien faire. Un liseré doré dit « c'est
      // ici » même sans mouvement, et il reste tant qu'on n'a pas visé ailleurs —
      // donc on retrouve sa place après avoir levé les yeux de son téléphone.
      vise && '-mx-2 rounded-lg bg-primary/5 px-2 ring-1 ring-primary/40',
    )}>
      {/* ⚠️ EN COLONNE SUR TÉLÉPHONE, en ligne à partir de `sm`. Les trois boutons
          de ressenti et un libellé ne tiennent pas côte à côte sur 375 px : ils s'y
          écrasaient, et la zone tactile devenait un piège. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{resultat.testLibelle}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{resultat.protocole}</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {resultat.vues.join(' · ')}
            {resultat.cible && <> · cible {resultat.cible}</>}
          </p>
          <ImagesDemo resultat={resultat} />
        </div>
        <div className="flex shrink-0 gap-1.5">
          {RESSENTIS.map(r => (
            <button
              key={r.valeur}
              type="button"
              disabled={lecture}
              // ⚠️ RECLIQUER DÉSÉLECTIONNE. Sans ça, un ressenti posé par erreur
              // était définitif : les trois valeurs s'excluent, donc rien ne
              // permettait de revenir à « pas encore renseigné ». Or c'est un état
              // réel et fréquent — un test qu'on n'a pas encore fait.
              //
              // `null` est bien accepté par le contrat (`ressenti: Ressenti | None`),
              // et il ne se confond pas avec « RAS » : « rien à signaler » est une
              // observation, « pas renseigné » est une absence d'observation.
              onClick={() => onEcrire({
                ressenti: resultat.ressenti === r.valeur ? null : r.valeur,
              })}
              // ⚠️ DORÉ (`bg-primary`) ET NON BLANC : c'est la couleur de l'état
              // actif partout ailleurs dans le produit. Une sélection qui ne
              // ressemble pas aux autres se lit mal, même bien visible.
              //
              // `h-10 flex-1` : cible tactile, et les trois se partagent la largeur
              // sur téléphone plutôt que de se serrer à droite.
              className={cn(
                'h-10 flex-1 rounded-md border px-3 text-xs transition-colors sm:flex-none',
                resultat.ressenti === r.valeur
                  ? 'border-transparent bg-primary font-medium text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent',
                lecture && 'cursor-default opacity-70',
              )}
            >
              {traduire(r.cle)}
            </button>
          ))}
        </div>
      </div>

      {resultat.mesure !== 'aucune' && (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
          {resultat.bilateral ? (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Gauche
                <ChampMesure valeur={resultat.mesureGauche} unite={unite} lecture={lecture}
                             onCommit={v => onEcrire({ mesureGauche: v })} />
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Droite
                <ChampMesure valeur={resultat.mesureDroite} unite={unite} lecture={lecture}
                             onCommit={v => onEcrire({ mesureDroite: v })} />
              </label>
            </>
          ) : (
            // ⚠️ UN SEUL CHAMP QUAND LE TEST N'A PAS DE CÔTÉ (§3.3). Le formulaire
            // d'origine posait « Droite/Gauche » sur des tests de TRONC, et le
            // serveur refuse désormais une mesure droite sur ceux-là : l'interface
            // ne doit donc pas l'offrir.
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Mesure
              <ChampMesure valeur={resultat.mesureGauche} unite={unite} lecture={lecture}
                           onCommit={v => onEcrire({ mesureGauche: v })} />
            </label>
          )}

          {charge != null && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Charge
              <ChampMesure valeur={charge} unite="kg" lecture={lecture}
                           
                           onCommit={v => onEcrire({ chargeKg: v })} />
              {resultat.materiel && <span className="text-[11px] text-muted-foreground/70">({resultat.materiel})</span>}
            </label>
          )}
        </div>
      )}

      {/* ⚠️ UN COMMENTAIRE PAR TEST, et il n'est pas décoratif : c'est là que se
          note ce qu'aucune case ne capture — « douleur au 3e set », « fait avec un
          disque de 12 faute de 15 ». Le champ `detail` existait dans le contrat
          depuis le premier jour ; l'écran ne l'affichait pas.

          Affiché POUR TOUS les tests, y compris ceux de mobilité qui n'ont aucune
          mesure : ce sont justement ceux où l'observation est tout ce qu'il y a. */}
      {(!lecture || resultat.detail) && (
        <div className="mt-2">
          {lecture ? (
            <p className="text-xs italic text-muted-foreground">{resultat.detail}</p>
          ) : (
            <input
              type="text"
              defaultValue={resultat.detail ?? ''}
              key={`detail-${resultat.id}`}
              placeholder={traduire('suiviKine.commentaire')}
              onBlur={e => {
                const v = e.target.value.trim();
                if (v !== (resultat.detail ?? '')) onEcrire({ detail: v || null });
              }}
              className="h-10 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground/60"
            />
          )}
        </div>
      )}

      {precedent && (
        <p className="mt-2 text-xs text-muted-foreground">
          {traduire('bilan.precedent')}{' '}
          <span className="font-mono tabular-nums">
            {versTexte(precedent.mesureGauche) || '—'}
            {resultat.bilateral && <> / {versTexte(precedent.mesureDroite) || '—'}</>}
          </span>
          {/* ⚠️ ON SIGNALE PLUTÔT QUE DE CALCULER UNE ÉVOLUTION. Deux bilans ne se
              comparent que si la charge coïncide : afficher « +5 s » entre 12 kg et
              15 kg serait une progression inventée. */}
          {chargesDifferentes && (
            <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-foreground">
              {traduire('bilan.chargeDifferente', { kg: precedent.chargeKg })}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
