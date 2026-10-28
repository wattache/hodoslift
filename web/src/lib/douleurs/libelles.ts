import type { TFunction } from 'i18next';

import type { ExerciceDeDouleur } from '@/api/types';
import { cleDuNom, litLeCode } from '@/lib/anatomie/zones';
import { afficherVariantes } from '@/lib/variantes';

/** Le nom lisible d'une zone : « Pectoraux gauche ».
 *
 *  ⚠️ LE CODE RESTE LE REPLI. Une zone retirée d'une planche future n'a plus de
 *  traduction : on affiche son slug plutôt qu'une clé i18n crue, qui serait
 *  illisible et ne dirait même pas de quoi il s'agit. */
export function nomDeZone(code: string, t: TFunction): string {
  const { slug, cote } = litLeCode(code);
  const zone = t(cleDuNom(slug), { defaultValue: slug });
  return cote ? `${zone} ${t(`anatomie.${cote}`)}` : zone;
}

/** Le nom COURT d'une zone, pour l'affichage : « Deltoïde ant. D ».
 *
 *  ⚠️ DEUX FONCTIONS, PAS UNE : la forme longue (`nomDeZone`) reste celle des
 *  lecteurs d'écran et des infobulles ; l'écran lit celle-ci. Le premier mot
 *  reste entier, les suivants s'abrègent, le côté se réduit à sa lettre. */
export function nomDeZoneCourt(code: string, t: TFunction): string {
  const { slug, cote } = litLeCode(code);
  const [tete, ...reste] = t(cleDuNom(slug), { defaultValue: slug }).split(' ');
  const zone = [tete, ...reste.map(m => (m.length > 4 ? `${m.slice(0, 3)}.` : m))].join(' ');
  return cote ? `${zone} ${t(`anatomie.${cote}Court`)}` : zone;
}

/** Les zones d'une douleur : « Épaule droite + Biceps droite ». */
export function nomDesZones(codes: string[], t: TFunction): string {
  return codes.map(c => nomDeZone(c, t)).join(' + ');
}

/** La ligne de séance telle qu'on la lit sur une note de douleur :
 *  « MUSCLE UP Strict · 5×3 @ 6 kg · EMOM ».
 *
 *  Le cliché vient de brokkr (réalisé s'il était saisi, sinon prescrit) ; ici
 *  on ne fait que l'écrire. Une charge au poids du corps (« PDC ») reste un
 *  mot, pas un nombre : on ne lui colle pas « kg ». */
export function libelleDExercice(
  e: Pick<ExerciceDeDouleur, 'name' | 'variant' | 'sets' | 'reps' | 'weight' | 'format'>,
): string {
  const variantes = afficherVariantes(e.variant);
  const mouvement = variantes ? `${e.name} ${variantes}` : e.name;
  const schema = [e.sets, e.reps].filter(Boolean).join('×');
  const charge = e.weight ? (/^\d/.test(e.weight) ? `${e.weight} kg` : e.weight) : '';
  const travail = [schema, charge].filter(Boolean).join(' @ ');
  return [mouvement, travail, e.format].filter(Boolean).join(' · ');
}
