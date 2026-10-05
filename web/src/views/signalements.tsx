import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { HeartPulse } from 'lucide-react';

import { useSignalements } from '@/api/hooks/use-signalements';
import { useAthleteSelection } from '@/lib/athlete-selection';
import type { Signalement } from '@/api/types';
import { cn } from '@/lib/utils';

/** LE TABLEAU DES SIGNALEMENTS — « qui va mal en ce moment ? »
 *
 *  Le kiné avait demandé une NOTIFICATION. Une liste répond mieux à la même
 *  question : elle se trie, elle se relit, elle ne se rate pas — et elle marche
 *  partout, sans installation ni autorisation. Le push reste possible ensuite,
 *  et cet écran dira d'abord s'il en vaut la peine.
 *
 *  COACH ET KINÉ y voient chacun LEURS athlètes : c'est le lien qui décide côté
 *  serveur (`coach_uid` / `kine_uid`), et quiconque ne staffe personne obtient
 *  une liste vide. Rien à filtrer ici.
 *
 *  ⚠️ AUCUNE QUESTION N'EST CONNUE DE CE FICHIER. Il parcourt le questionnaire
 *  (`lib/kine-questionnaire.ts`), qui n'est pas arrêté. Une question ajoutée
 *  s'affiche ici sans y toucher.
 */

/** Le repère visuel de l'écran : une intensité forte doit se voir sans lire.
 *
 *  ⚠️ SEUILS SUR L'ÉCHELLE DÉCLARÉE, pas sur 10 en dur — le jour où le
 *  questionnaire passe à /5, ce code suivrait sans qu'on y pense. Et « pas
 *  renseigné » ne colore RIEN : ce n'est pas une douleur faible, c'est une
 *  absence de réponse. */
export function tonIntensite(valeur: unknown, max: number): string {
  if (typeof valeur !== 'number') return 'text-muted-foreground';
  const part = valeur / max;
  if (part >= 0.7) return 'text-destructive';
  if (part >= 0.4) return 'text-[var(--serie-poids)]';
  return 'text-muted-foreground';
}

/** ⚠️ L'ÉCHELLE EST FIXE DEPUIS FRE-195 : la douleur se note de 0 à 10, et
 *  c'est le contrat serveur qui le garantit. Elle venait d'un questionnaire
 *  libre dont la borne haute pouvait changer ; ce n'est plus une question
 *  ouverte, donc plus un réglage à lire. */
const MAX_INTENSITE = 10;

function Ligne({ s, onOuvrir }: { s: Signalement; onOuvrir: () => void }) {
  const { t } = useTranslation();
  // La plus forte en tête — c'est l'ordre du serveur, et ce qu'on vient voir.
  const pire = s.douleurs[0];
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
      <Link
        to="/kine"
        onClick={onOuvrir}
        className="text-sm font-semibold text-foreground hover:text-gold"
      >
        {s.firstName} {s.lastName}
      </Link>
      {pire && (
        <span className={cn('font-mono text-sm font-semibold tabular-nums',
          tonIntensite(pire.intensite, MAX_INTENSITE))}>
          {pire.intensite}/{MAX_INTENSITE}
        </span>
      )}
      <span className="w-full text-sm text-muted-foreground sm:w-auto">
        {s.douleurs.map(d => [
          d.nom,
          // ⚠️ « ÇA REVIENT » SE LIT ICI AUSSI : c'est ce qui distingue une gêne
          // d'un jour d'une douleur qui s'installe, et c'est la question de cet
          // écran. Le compte vient du serveur, on ne le recalcule pas.
          d.recurrente ? t('douleurs.recurrente', { count: d.logs }) : null,
          d.commentaire,
        ].filter(Boolean).join(' · ')).join(' — ')}
      </span>
    </li>
  );
}

export function SignalementsView() {
  const { t } = useTranslation();
  const [jours, setJours] = useState<7 | 30 | 90>(30);
  const { data: signalements = [], isLoading } = useSignalements(jours);
  const sel = useAthleteSelection();

  // Cliquer un nom OUVRE cet athlète, puis va sur son suivi. Sans la sélection,
  // /kine afficherait l'athlète précédemment choisi — un écran qui répond à
  // côté, et c'est le genre de décalage qu'on ne remarque qu'en production.
  const ouvrir = (s: Signalement) => {
    const cible = sel.athletes.find(a => a.id === s.athleteId);
    if (cible) sel.setSelectedId(cible.id);
  };

  const parJour = useMemo(() => {
    const groupes = new Map<string, Signalement[]>();
    for (const s of signalements) {
      const liste = groupes.get(s.date);
      if (liste) liste.push(s);
      else groupes.set(s.date, [s]);
    }
    return [...groupes.entries()];
  }, [signalements]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <HeartPulse className="h-5 w-5 text-[var(--serie-poids)]" />
          {t('nav.signalements')}
        </h1>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
          {([7, 30, 90] as const).map(n => (
            <button
              key={n}
              type="button"
              onClick={() => setJours(n)}
              className={cn('h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                jours === n ? 'bg-gold text-gold-foreground'
                  : 'text-muted-foreground hover:text-foreground')}
            >
              {n} j
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : parJour.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          {/* Un vide qui se LIT comme une bonne nouvelle, pas comme une panne. */}
          Aucun signalement sur cette période — personne ne remonte de douleur.
        </div>
      ) : (
        parJour.map(([date, lignes]) => (
          <section key={date} className="rounded-xl border border-border bg-card p-4">
            <h2 className="mb-2 font-mono text-xs tabular-nums text-muted-foreground">{date}</h2>
            <ul className="flex flex-col divide-y divide-border">
              {lignes.map(s => (
                <Ligne key={`${s.athleteId}:${s.date}`} s={s} onOuvrir={() => ouvrir(s)} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
