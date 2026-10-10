import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CODES_TRADUITS } from '@/lib/save-error';

import fr from './locales/fr.json';
import en from './locales/en.json';
import pl from './locales/pl.json';

/** LES DEUX FAÇONS DONT UNE TRADUCTION ÉCHOUE SANS QUE RIEN NE LE DISE.
 *
 *  ⚠️ `tsc` NE VOIT NI L'UNE NI L'AUTRE, et c'est toute la raison de ce fichier.
 *  Une chaîne reste une chaîne quel que soit ce qu'elle contient, et `t()` rend
 *  une `string` que la clé existe ou non. Les deux défauts compilent, passent le
 *  lint, et ne se voient qu'à l'écran — donc, en pratique, chez l'utilisateur.
 *
 *  Les deux se sont produits pendant FRE-113 même, sur trois écrans :
 *  `competition-detail`, et deux fois `bilan`.
 */

const RACINE = join(import.meta.dirname, '..');
const EXCLUS = ['/i18n/locales/', '/api/brokkr.gen.ts'];

function sources(dossier: string, vus: string[] = []): string[] {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) sources(chemin, vus);
    else if (/\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom)
             && !EXCLUS.some(x => chemin.includes(x))) vus.push(chemin);
  }
  return vus;
}

const PLURIEL = /_(one|few|many|other)$/;
const aplatir = (o: object, prefixe = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? aplatir(v, `${prefixe}${k}.`) : [`${prefixe}${k}`]);

const FICHIERS = sources(RACINE).map(chemin => ({
  chemin: chemin.slice(RACINE.length + 1),
  texte: readFileSync(chemin, 'utf-8'),
}));

describe('les appels de traduction', () => {
  /** ⚠️ LE DÉFAUT EXACT : un remplacement textuel ne distingue pas un nœud JSX
   *  d'une chaîne. `'Introuvable'` remplacé par `'{t("…")}'` compile
   *  parfaitement — et l'écran affiche `{t("competition.competitionIntrouvable")}`
   *  en toutes lettres, accolades comprises. */
  it('ne sont jamais ENFERMÉS dans une chaîne', () => {
    const fautes = FICHIERS.flatMap(({ chemin, texte }) =>
      texte.split('\n').flatMap((ligne, i) =>
        /['"`]\{\s*(t|traduire|i18n\.t)\s*\(/.test(ligne)
          ? [`${chemin}:${i + 1} — ${ligne.trim()}`] : []));
    expect(fautes).toEqual([]);
  });

  /** ⚠️ ET UNE CLÉ ABSENTE NE LÈVE RIEN : i18next rend la clé elle-même. Un
   *  `t('bilan.finaliser')` sans entrée affiche `bilan.finaliser` au milieu de
   *  la page, ce qui ressemble à un identifiant technique échappé — le genre de
   *  chose qu'on ne remarque que si on ouvre précisément cet écran.
   *
   *  Seules les clés LITTÉRALES sont vérifiables : `t(\`session.kind.${'${kind}'}\`)`
   *  se résout à l'exécution, et les vérifier demanderait de connaître les
   *  valeurs possibles. Elles sont rares et regroupées. */
  it('visent une clé qui EXISTE, dans les trois langues', () => {
    const resout = (dico: object, cle: string) =>
      cle.split('.').reduce<unknown>((n, p) =>
        (n && typeof n === 'object' && p in n) ? (n as Record<string, unknown>)[p] : undefined, dico);

    const manquantes = FICHIERS.flatMap(({ chemin, texte }) =>
      [...texte.matchAll(/\b(?:t|traduire|i18n\.t)\(\s*['"]([\w.]+)['"]/g)].flatMap(m => {
        const cle = m[1];
        // Un pluriel s'écrit `cle` et se stocke `cle_one` / `cle_other`.
        const existe = (d: object) =>
          typeof resout(d, cle) === 'string' || typeof resout(d, `${cle}_other`) === 'string';
        return existe(fr) && existe(en) && existe(pl) ? [] : [`${chemin} — ${cle}`];
      }));
    expect(manquantes).toEqual([]);
  });

  /** Le pendant : une clé que PLUS RIEN n'appelle. Moins grave — elle ne se voit
   *  pas — mais elle se traduit, se relit et se maintient pour rien. Sans
   *  assertion ici : les clés dynamiques rendraient la liste fausse. */
  it('laissent les trois fichiers de langue AVEC LES MÊMES CLÉS', () => {
    expect(aplatir(en).sort()).toEqual(aplatir(fr).sort());
    // ⚠️ Le polonais se compare au LIBELLÉ, pas à la forme : son pluriel en a quatre.
    const libelles = (d: object) => [...new Set(aplatir(d).map(k => k.replace(PLURIEL, '')))].sort();
    expect(libelles(pl)).toEqual(libelles(fr));
  });
  /** ⚠️ UN PLURIEL POLONAIS À DEUX FORMES EST UN TROU : i18next retombe sur
   *  `_other` pour 2, 3, 4 (« 2 tygodni » au lieu de « 2 tygodnie »), et rien ne
   *  le dit. Toute clé qui porte une forme les porte toutes. */
  it('donnent au polonais ses QUATRE formes de pluriel', () => {
    const cles = new Set(aplatir(pl));
    const incomplets = [...new Set([...cles].filter(k => PLURIEL.test(k)).map(k => k.replace(PLURIEL, '')))]
      .filter(base => !['one', 'few', 'many', 'other'].every(f => cles.has(`${base}_${f}`)));
    expect(incomplets).toEqual([]);
  });
});

/** LA FAMILLE DE CLÉS QUE LA SPEC CI-DESSUS NE PEUT PAS VOIR — FRE-140.
 *
 *  ⚠️ ELLE L'ANNONCE ELLE-MÊME : « seules les clés LITTÉRALES sont vérifiables ».
 *  `save-error.ts` construit `saveError.code.${'${e.code}'}.title`, donc aucune de
 *  ces trente clés n'est vue par le scan — et l'une d'elles était rangée un
 *  NIVEAU TROP HAUT, à `saveError.semaine_deja_remplie`.
 *
 *  ⚠️ ET LES DEUX AUTRES GARDES LA LAISSAIENT PASSER AUSSI, chacune pour une
 *  bonne raison : la parité des fichiers est intacte, puisque l'erreur est
 *  IDENTIQUE en français et en anglais. Trois specs vertes, et le coach qui
 *  tentait de régénérer une semaine remplie lisait
 *  `saveError.code.semaine_deja_remplie.title` dans son toast.
 *
 *  Le vocabulaire, lui, est connu : `CODES_TRADUITS` est déjà contraint par le
 *  type engendré depuis l'OpenAPI (`satisfies readonly CodeErreur[]`). Il suffit
 *  de le dérouler — c'est-à-dire de faire ce que la clé dynamique empêche le
 *  scan de faire.
 */
describe('les codes d’erreur traduits', () => {
  it('ont TOUS leur titre, dans les trois langues', () => {
    const titre = (dico: object, code: string) =>
      (dico as Record<string, Record<string, Record<string, { title?: string }>>>)
        .saveError?.code?.[code]?.title;

    const manquants = CODES_TRADUITS.flatMap(code => {
      const absentes = [
        ...(typeof titre(fr, code) === 'string' ? [] : ['fr']),
        ...(typeof titre(en, code) === 'string' ? [] : ['en']),
        ...(typeof titre(pl, code) === 'string' ? [] : ['pl']),
      ];
      return absentes.length ? [`${code} — absent de ${absentes.join(' et ')}`] : [];
    });
    expect(manquants).toEqual([]);
  });
});
