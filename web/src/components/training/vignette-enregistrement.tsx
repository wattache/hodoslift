import { Check, CircleAlert, CloudCheck, CloudOff, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EtatEnregistrement } from '@/lib/patchs-en-attente';

/** LA VIGNETTE D'ENREGISTREMENT (FRE-32).
 *
 *  ⚠️ CE QU'ELLE CORRIGE : une valeur affichée ne se distinguait pas d'une valeur
 *  enregistrée. La cellule ne valide qu'au blur, l'envoi est différé de 400 ms, et
 *  l'écran affiche la nouvelle valeur dès la frappe. Un coach qui corrigeait une
 *  séance et fermait l'onglet croyait avoir corrigé — c'est arrivé le 13/08 sur de
 *  la donnée réelle d'athlète.
 *
 *  ⚠️ L'ÉTAT AU REPOS EST L'APPORT PRINCIPAL, pas le sablier. Un indicateur qui
 *  disparaît ne se distingue pas d'un indicateur jamais apparu : c'est
 *  « Enregistré » qui dit qu'on peut fermer l'onglet, et il PERSISTE jusqu'à la
 *  frappe suivante au lieu de s'effacer après un délai.
 *
 *  ⚠️ ET ELLE EST UNIQUE, PAS UNE PAR CELLULE. Avec 400 ms de debounce et un
 *  PATCH bref, un témoin par champ clignoterait à chaque frappe sur toute la
 *  table — du bruit qu'on apprend à ignorer, donc l'inverse du but.
 *
 *  L'échec, lui, n'est pas ici : il a déjà son toast (`toastSaveError`). Le dire
 *  deux fois donnerait deux vocabulaires pour un seul événement.
 *
 *  ⚠️ SAUF UN — L'ATTENTE DE RÉSEAU (FRE-118), et justement parce qu'elle n'a
 *  PAS de toast. Hors ligne, on n'interrompt pas une série pour annoncer à
 *  l'athlète ce qu'il sait déjà. Mais on ne peut pas non plus laisser le sablier
 *  tourner indéfiniment : « Enregistrement… » pour toujours est le mensonge le
 *  plus proche de la vérité, donc le plus trompeur. La vignette dit ce qui est —
 *  c'est gardé, ça partira — et c'est le seul endroit qui puisse le dire sans
 *  couper le geste.
 *
 *  ⚠️ ET LE NUAGE VIT DEDANS, PAS À CÔTÉ (FRE-118). « Sur ton téléphone » est
 *  une promesse DIFFÉRENTE — l'inverse, même : la vignette dit que ce qu'on a
 *  tapé est parti (téléphone → serveur), le nuage dit que ce que le serveur a
 *  donné est gardé ici (serveur → téléphone). Les deux sont indépendantes, on
 *  peut avoir l'une sans l'autre.
 *
 *  Elles ont pourtant commencé leur vie en DEUX pastilles côte à côte, et
 *  William les a lues comme un doublon au premier coup d'œil — « il y en a déjà
 *  un, non ? ». Il avait raison sur ce qui compte : deux objets de même taille,
 *  dans la même zone, disant tous deux « c'est bon », ne se distinguent pas. Un
 *  seul objet, deux glyphes : on lit l'état d'enregistrement, et le nuage
 *  qualifie. */
export function VignetteEnregistrement(
  { etat, horsLigne = false }: { etat: EtatEnregistrement; horsLigne?: boolean },
) {
  const { t } = useTranslation();
  // Rien n'a encore été écrit : annoncer « Enregistré » affirmerait quelque chose
  // d'une écriture qui n'a pas eu lieu. Le nuage, lui, a du sens tout seul : il
  // ne parle pas d'une écriture mais de ce qui est déjà là.
  if (etat === 'repos' && !horsLigne) return null;

  const enCours = etat === 'en-cours';
  const enAttente = etat === 'en-attente';
  // ⚠️ L'ÉCHEC RESTE AFFICHÉ, comme « Enregistré » : le toast passe, et c'est
  // ici qu'on relit avant de fermer. Aubin a lu « Enregistré » sur une trame
  // partie dans le vide, et a tout retapé (25/09).
  const enEchec = etat === 'echec';
  return (
    <div
      // `aria-live="polite"` : l'information est utile au lecteur d'écran — c'est
      // la seule qui dise si la frappe est partie — mais elle ne doit pas couper
      // la lecture en cours, puisqu'elle change à chaque saisie.
      aria-live="polite"
      className="flex items-center gap-1.5 rounded-md border border-border/80 bg-card/80 px-2 py-1 text-[11px] text-muted-foreground"
    >
      {etat !== 'repos' && (
        <>
          {enAttente
            ? <CloudOff className="h-3 w-3 text-gold" aria-hidden />
            : enCours
              ? <Loader2 className="h-3 w-3 animate-spin text-gold" aria-hidden />
              : enEchec
                ? <CircleAlert className="h-3 w-3 text-destructive" aria-hidden />
                : <Check className="h-3 w-3 text-gold" aria-hidden />}
          <span className={enEchec ? 'font-medium text-destructive' : undefined}>
            {t(enAttente ? 'training.gardePartiraAuReseau'
              : enCours ? 'training.enregistrementEnCours'
              : enEchec ? 'training.nonEnregistre' : 'training.enregistre')}
          </span>
        </>
      )}
      {horsLigne && (
        <>
          {/* Le séparateur n'existe que s'il y a deux choses à séparer. */}
          {etat !== 'repos' && <span className="text-border" aria-hidden>·</span>}
          {/* ⚠️ UNE ICÔNE SEULE, MAIS PAS MUETTE. Elle porte son nom pour un
              lecteur d'écran et une infobulle pour la souris : sans ça,
              l'information n'existe que pour qui reconnaît un pictogramme. */}
          <span title={t('training.horsLigneAide')} className="flex items-center">
            <CloudCheck className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{t('training.horsLignePret')}</span>
          </span>
        </>
      )}
    </div>
  );
}
