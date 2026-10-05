import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** LA DOCUMENTATION DU PRODUIT — section « Documentation », sous-section
 *  « Tracking ».
 *
 *  ⚠️ IL EXISTE PARCE QUE LES RÈGLES SE DEVINENT MAL, ET QUE LES DEVINER COÛTE.
 *  Demandé par William le 11/09, après s'être trompé deux fois de suite sur sa
 *  propre donnée : d'abord « mes lignes n'entrent pas dans le tonnage » (elles y
 *  sont toutes), puis « pour les records on ne prend que là où il y a un RPE »
 *  (une case vide n'écarte rien, seul un FAIL le fait). Si l'auteur du produit
 *  se trompe, un coach n'a aucune chance.
 *
 *  ⚠️ CHAQUE RÈGLE EST ILLUSTRÉE PAR UN CAS CHIFFRÉ. Une définition abstraite se
 *  relit sans être comprise ; « 4 séries notées 7 / — / 8 / FAIL font 2 séries
 *  tenues » se vérifie contre sa propre séance.
 *
 *  ⚠️ ET C'EST UNE DOC, PAS UNE SPEC. Elle décrit ce que le serveur fait
 *  aujourd'hui ; si le serveur change, ce fichier ment. C'est le prix d'une
 *  documentation écrite à la main. Ce qu'il faut relire, section par section :
 *
 *      le tonnage           `brokkr/scripts/etl_training_sets.py`
 *      les séries qui comptent  `ff_series_tenues` (postgres-schema.sql)
 *      les records          `brokkr/app/records.py`
 *      les records all-time `brokkr/app/routers/prs.py` (table `athlete_prs`)
 *      ce qui n'entre pas   `brokkr/app/routers/tracking.py`
 *
 *  ⚠️ ET CES NOMS RESTENT ICI, PAS À L'ÉCRAN. Ils y étaient, sous chaque titre :
 *  « côté user, pas de gens dans le code » (William, 11/09). Un coach qui lit
 *  « ff_series_tenues » n'apprend rien et se demande s'il a ouvert la mauvaise
 *  page.
 *
 *  ⚠️ ELLE A VÉCU DANS L'ONGLET TRACKER, DONC SOUS UN ATHLÈTE — et c'est ce qui
 *  a été corrigé (William, 11/09 : « le dupliquer pour chaque athlète, ce n'est
 *  pas intelligent »). Une règle de calcul ne décrit personne : elle ne se range
 *  pas sous quelqu'un. Elle est désormais une page à elle, hors de l'espace
 *  athlète, et la sélection de la barre latérale n'a plus d'effet dessus.
 *
 *  ⚠️ ET LE PLI A DISPARU AVEC LE DÉPLACEMENT. Il existait parce que l'encart
 *  s'intercalait entre la saisie du jour et les graphes : replié, il ne leur
 *  coûtait qu'une ligne. Sur une page dédiée il n'y a rien à repousser, et un
 *  pli mettrait un clic devant ce qu'on vient précisément lire. Ce sera à
 *  reconsidérer quand une SECONDE sous-section existera. */
export function DocumentationView() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold uppercase leading-none tracking-wide">
          {t('nav.documentation')}
        </h1>
      </header>

      <section className="rounded-xl border border-border/80 bg-card p-5 shadow-[0_16px_42px_rgba(0,0,0,0.16)]">
        <h2 className="text-sm font-semibold">{t('doc.titre')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('doc.sousTitre')}</p>

      <div className="mt-4 flex flex-col border-t border-border/60 pt-4">
        <Section numero="01" titre={t('doc.tonnage.titre')}>
          <Regle principale texte={t('doc.tonnage.definition')} />
          <Exemple libelle={t('doc.tonnage.ex1Cas')} resultat={t('doc.tonnage.ex1Res')}
                   avertissement={t('doc.tonnage.ex1Piege')} />
          <Regle texte={t('doc.tonnage.realise')} />
          <Regle texte={t('doc.tonnage.fourchette')} />
          <Exemple libelle={t('doc.tonnage.ex2Cas')} resultat={t('doc.tonnage.ex2Res')} resultatNeutre />
          <Regle texte={t('doc.tonnage.sansCharge')} />
        </Section>

        <Section numero="02" titre={t('doc.series.titre')}>
          <Regle principale texte={t('doc.series.sansEchec')} />
          <Exemple libelle={t('doc.series.ex1Cas')} resultat={t('doc.series.ex1Res')} />
          <Regle texte={t('doc.series.avecEchec')} />
          <Exemple libelle={t('doc.series.ex2Cas')} resultat={t('doc.series.ex2Res')} />
          <Exemple libelle={t('doc.series.ex3Cas')} resultat={t('doc.series.ex3Res')}
                   avertissement={t('doc.series.ex3Piege')} />
          <Regle texte={t('doc.series.pasUnFiltre')} />
        </Section>

        <Section numero="03" titre={t('doc.records.titre')}>
          <Regle principale texte={t('doc.records.serieePasLigne')} />
          <Regle texte={t('doc.records.sansDetail')} />
          <Regle texte={t('doc.records.avecDetail')} />
          <Exemple libelle={t('doc.records.ex1Cas')} resultat={t('doc.records.ex1Res')} />
          <Regle texte={t('doc.records.retenu')} />
          <Exemple libelle={t('doc.records.ex2Cas')} resultat={t('doc.records.ex2Res')} resultatNeutre
                   avertissement={t('doc.records.ex2Piege')} />
        </Section>

        <Section numero="04" titre={t('doc.allTime.titre')}>
          <Regle principale texte={t('doc.allTime.aLaMain')} />
          <Regle texte={t('doc.allTime.identite')} />
          <Exemple libelle={t('doc.allTime.ex1Cas')} resultat={t('doc.allTime.ex1Res')} resultatNeutre />
          <Regle texte={t('doc.allTime.pasLeRM')} />
        </Section>

        <Section numero="05" titre={t('doc.horsCompte.titre')} derniere>
          <Regle principale texte={t('doc.horsCompte.echauffement')} />
          <Regle texte={t('doc.horsCompte.secondes')} />
          <Regle texte={t('doc.horsCompte.variante')} />
        </Section>
      </div>
      </section>
    </div>
  );
}

/** ⚠️ LE TITRE EST NUMÉROTÉ, ET CE N'EST PAS DE L'ORNEMENT. Cinq titres or de
 *  même graisse ne se distinguaient pas les uns des autres : rien ne disait où
 *  l'on en était ni combien il en restait. Le numéro est en revanche DÉCORATIF
 *  à l'oral — un lecteur d'écran annonce déjà le rang du titre.
 *
 *  ⚠️ ET L'OR EST À PLEINE OPACITÉ. `text-gold/75` sur onze pixels tombe sous le
 *  seuil de contraste : l'alpha coûte deux fois, en clarté et en saturation. */
function Section({ numero, titre, derniere = false, children }: {
  numero: string; titre: string; derniere?: boolean; children: React.ReactNode;
}) {
  return (
    <section className={cn('flex flex-col gap-3 py-5 first:pt-0',
                           !derniere && 'border-b border-border/45')}>
      <h3 className="flex items-center gap-3">
        <span aria-hidden="true" className="font-mono text-[11px] font-medium"
              style={{ color: 'oklch(0.66 0.11 82)' }}>
          {numero}
        </span>
        <span className="font-display text-[17px] uppercase tracking-[0.1em] text-gold">{titre}</span>
        <span aria-hidden="true" className="h-px grow bg-gold/15" />
      </h3>
      {children}
    </section>
  );
}

/** ⚠️ LA MESURE EST PLAFONNÉE À 62 CARACTÈRES, et c'est le geste qui porte tout
 *  le reste. Le texte courait sur toute la largeur du Tracker — près de 180
 *  caractères par ligne, trois fois le confort de lecture. À cette longueur
 *  l'œil perd le début de la ligne suivante, et aucun réglage de taille ou de
 *  couleur ne le rattrape.
 *
 *  ⚠️ C'EST LE CONTENU QUI EST PLAFONNÉ, PAS LA BOÎTE. Le panneau garde sa
 *  largeur pleine dans la page ; seule la colonne de lecture est bornée.
 *
 *  ⚠️ ET DEUX NIVEAUX, PARCE QUE VINGT RÈGLES DE MÊME POIDS N'EN ONT AUCUN. La
 *  définition qui porte la section et la précision qui la nuance se lisaient
 *  identiques : rien ne disait laquelle retenir. Le choix des cinq principales
 *  est ÉDITORIAL — les clés ne l'encodent pas, et on ne les renomme pas pour
 *  l'y mettre : ce serait une migration des deux locales pour un gain nul. */
function Regle({ texte, principale = false }: { texte: string; principale?: boolean }) {
  return (
    <p className={cn('max-w-[62ch] leading-relaxed',
                     principale ? 'text-[15px] text-foreground' : 'text-sm text-muted-foreground')}>
      {texte}
    </p>
  );
}

/** UN CAS CHIFFRÉ, EN DEUX ÉTAGES : voilà le cas et son résultat ; voilà, s'il
 *  y a lieu, ce qu'on croirait à tort.
 *
 *  ⚠️ LA FLÈCHE VIT DANS LE MÊME SPAN QUE LE CAS, et c'est structurel. En enfant
 *  séparé du flex, elle suivait le résultat jusqu'au bord droit et ne désignait
 *  plus rien — à 1 400 px, six cents pixels séparaient le cas de sa flèche.
 *
 *  ⚠️ `shrink` SUR LE CAS, `grow` SUR LE RÉSULTAT. L'inverse étirerait la boîte
 *  du cas jusqu'au bord et écarterait les deux seuls points d'ancrage de la
 *  page. Ainsi, les résultats forment une colonne qu'on parcourt sans lire un
 *  seul cas. */
function Exemple({ libelle, resultat, resultatNeutre = false, avertissement }: {
  libelle: string; resultat: string;
  /** ⚠️ L'OR SIGNALE UNE VALEUR. « pas de tonnage », « la série ne compte pas »,
   *  « deux records distincts » ne sont pas des grandeurs : les dorer ferait
   *  croire à un chiffre là où il n'y en a pas. Une prop explicite plutôt qu'une
   *  heuristique sur la chaîne, qui casserait à la première traduction. */
  resultatNeutre?: boolean;
  avertissement?: string;
}) {
  return (
    <div className="max-w-[62ch] overflow-hidden rounded-md border border-border/60 bg-background/40">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3.5 py-2.5">
        <span className="shrink font-mono text-[12.5px] leading-snug text-foreground">
          {libelle}
          <span aria-hidden="true" className="ml-2 text-muted-foreground/60">→</span>
        </span>
        <span className={cn('grow text-right font-mono text-[13px] font-medium tabular-nums',
                            resultatNeutre ? 'text-foreground/80' : 'text-gold')}>
          {resultat}
        </span>
      </div>
      {avertissement && (
        /* ⚠️ HORS DU MONOSPACE, ET EN ROUGE ÉCLAIRCI. Une phrase de quarante
           mots en chasse fixe se lit mal — la police est faite pour des chiffres
           alignés. Et `text-destructive` pur ne tient pas 4,5:1 sur ce fond à
           cette taille : la teinte est remontée en clarté. */
        <div className="flex items-start gap-2.5 border-t border-destructive/20 bg-destructive/5 px-3.5 py-2.5">
          <span aria-hidden="true"
                className="mt-px flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border border-destructive text-[11px] font-bold leading-none text-destructive">
            !
          </span>
          <p className="text-[13.5px] leading-snug" style={{ color: 'oklch(0.84 0.07 25)' }}>
            {avertissement}
          </p>
        </div>
      )}
    </div>
  );
}
