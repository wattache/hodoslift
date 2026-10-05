import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { todayIso } from '@/lib/dates';
import type { Athlete, AthleteProfilePatch } from '@/api/types';
import { usePatchAthleteProfile, useSetAthleteKine } from '@/api/hooks/use-athletes';
import { useKines } from '@/api/hooks/use-users';
import { toastSaveError } from '@/lib/save-error';

/** LA FICHE DE L'ATHLÈTE — prénom, nom, email, poids, taille, date de
 *  naissance, genre, suivi kiné (William, 27/09 : « tout ce qu'il y a sur le
 *  screenshot »). Elle vivait dans une fenêtre ouverte depuis le tableau de
 *  bord ; elle a maintenant son onglet, pour y ranger la suite.
 *
 *  Chaque champ est persisté indépendamment au blur (PATCH /profile). Sans
 *  gestion, la fiche se LIT : brokkr refuse l'écriture aux autres (autz
 *  `coach`), donc aucun champ ne s'offre. */
export function FicheAthlete({ athlete, canManage }: { athlete: Athlete; canManage: boolean }) {
  const { t } = useTranslation();
  const patchProfile = usePatchAthleteProfile();
  const setAthleteKine = useSetAthleteKine();
  // La liste ne se charge que si elle peut servir (coach gestionnaire).
  const { data: kines = [] } = useKines(canManage);

  const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;
  const patch = (p: AthleteProfilePatch) => {
    patchProfile.mutate({ athleteId: athlete.id, patch: p }, { onError: toastSaveError });
  };
  const age = athlete.age ? `${athlete.age} ${t('profile.ansUnite')}` : null;

  if (!canManage) {
    const lignes: [string, string | null][] = [
      [t('profile.prenom'), athlete.firstName],
      [t('common.nom'), athlete.lastName],
      ['Email', athlete.email ?? null],
      [t('tracker.weight'), athlete.weight ? `${athlete.weight} kg` : null],
      [t('common.taille'), athlete.height ? `${athlete.height} cm` : null],
      [t('profile.dateDeNaissance'), athlete.birthDate ? [athlete.birthDate, age].filter(Boolean).join(' · ') : null],
      [t('common.genre'), athlete.gender || null],
    ];
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {lignes.map(([libelle, valeur]) => (
          <div key={libelle} className="contents">
            <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{libelle}</dt>
            <dd className={valeur ? '' : 'text-muted-foreground'}>{valeur ?? '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('profile.chaqueChampEstEnregistre')}</p>
      <div className="flex gap-3">
        <EditField label={t('profile.prenom')} value={athlete.firstName} onCommit={(v) => patch({ firstName: v.trim() })} />
        <EditField label={t('common.nom')} value={athlete.lastName} onCommit={(v) => patch({ lastName: v.trim() })} />
      </div>

      {/* ⚠️ L'EMAIL SE FIGE DÈS QUE LA FICHE PORTE UN COMPTE (FRE-131).
          brokkr répond 409 `email_fige_par_le_compte` : proposer la saisie
          serait proposer une écriture qu'il refuse. Avant liaison, le champ
          reste libre — c'est le geste d'onboarding, et il est fréquent. */}
      <EditField
        label="Email"
        type="email"
        value={athlete.email ?? ''}
        fige={athlete.linkedUserId ? t('profile.emailVientDuCompte') : undefined}
        onCommit={(v) => patch({ email: v.trim() })}
      />

      <div className="flex gap-3">
        <EditField label={t('tracker.weight')} type="number" suffix="kg" value={athlete.weight ? String(athlete.weight) : ''} onCommit={(v) => patch({ weight: num(v) })} />
        <EditField label={t('common.taille')} type="number" suffix="cm" value={athlete.height ? String(athlete.height) : ''} onCommit={(v) => patch({ height: num(v) })} />
      </div>

      {/* ⚠️ UNE DATE, PLUS UN ÂGE (FRE-168) : l'entier saisi vieillissait sans
          que rien ne le signale. L'âge affiché est calculé par brokkr.
          ⚠️ LE `DatePicker` DE L'APP, PAS `<input type="date">` : l'icône du
          calendrier natif est noire, donc invisible sur le fond sombre. Listes
          mois + année, parce qu'une naissance est à trente ans de flèches.
          « Effacer » envoie `''`, que brokkr lit comme « effacer ». */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('profile.dateDeNaissance')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={athlete.birthDate ?? ''}
            max={todayIso()}
            choixDeLAnnee
            title={t('profile.dateDeNaissance')}
            className="h-9 flex-1 justify-start text-sm"
            onChange={(v) => patch({ birthDate: v })}
          />
          {age && <span className="font-mono text-sm text-gold">{age}</span>}
          {athlete.birthDate && (
            <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => patch({ birthDate: '' })}>
              {t('profile.effacerLaDate')}
            </Button>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('common.genre')}</span>
        <select
          value={athlete.gender ?? ''}
          onChange={(e) => patch({ gender: e.target.value as 'M' | 'F' | '' })}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">—</option>
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>

      {/* Suivi kiné (FRE-65) : le coach confie le suivi — c'est LE geste qui
          ouvre au kiné la lecture du programme. « Aucun » détache. */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t('profile.suiviKine')}</span>
        <select
          value={athlete.kineUid ?? ''}
          onChange={(e) =>
            setAthleteKine.mutate({ athleteId: athlete.id, kineUid: e.target.value || null }, { onError: toastSaveError })
          }
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('common.none')}</option>
          {kines.map(k => (
            <option key={k.uid} value={k.uid}>{k.displayName || k.email}</option>
          ))}
        </select>
      </label>

      {/* ⚠️ PAS DE BOUTON « DÉTACHER LE COMPTE » ICI — retiré le 22/08 (FRE-76).
          Le cas qu'il réparait ne s'est jamais produit ; la route
          `DELETE /athletes/{id}/link` reste côté brokkr pour ce dépannage-là. */}
    </div>
  );
}

function EditField({
  label, value, type = 'text', suffix, onCommit, fige,
}: {
  label: string;
  value: string;
  type?: 'text' | 'number' | 'email';
  suffix?: string;
  onCommit: (v: string) => void;
  fige?: string;
}) {
  const [draft, setDraft] = useState(value);
  const idNote = useId();
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="relative flex items-center">
        <Input
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          value={draft}
          readOnly={Boolean(fige)}
          disabled={Boolean(fige)}
          // ⚠️ SANS ÇA, L'EXPLICATION DEVIENT LE NOM DU CHAMP. Tout le texte
          // contenu dans un `<label>` compose le nom accessible : la note se
          // serait collée au libellé. Le nom reste le libellé, la note DÉCRIT.
          aria-label={fige ? label : undefined}
          aria-describedby={fige ? idNote : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!fige && draft !== value) onCommit(draft); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className={suffix ? 'pr-9' : undefined}
        />
        {suffix && <span className="absolute right-3 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      {fige && <span id={idNote} className="text-[11px] leading-snug text-muted-foreground">{fige}</span>}
    </label>
  );
}
