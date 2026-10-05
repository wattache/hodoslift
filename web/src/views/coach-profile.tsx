import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CoachProfilePatch } from '@/api/types';
import {
  useMyCoachProfile,
  usePatchMyCoachProfile,
  useUploadMyCoachPhoto,
} from '@/api/hooks/use-coach-profile';
import { LANGUES, langue } from '../../landing/langues.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** « Ma page publique » — le coach édite ce que voit le site vitrine (FRE-30).
 *
 *  Trois champs seulement, parce que ce sont les trois que brokkr accepte. La
 *  photo passe par son propre endpoint et les records viennent de la Table RM :
 *  ils s'affichent ici en lecture, pour que le coach voie ce qui est publié sans
 *  croire qu'il peut le corriger à cet endroit.
 *
 *  ⚠️ Tout ce qui est saisi ici devient PUBLIC, lisible sans compte. La vue le
 *  dit explicitement plutôt que de le laisser deviner. */

const SLUG_VALIDE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SITE = 'https://french-forge.com';

/** Un slug lisible depuis un nom : « Théo Goutte-Toquet » → « theo-goutte-toquet ».
 *  Les accents sont décomposés puis retirés — sans quoi « Théo » donnerait
 *  « th-o », et l'URL publique du coach porterait une faute définitive (le slug
 *  est immuable une fois créé). */
function slugifier(valeur: string): string {
  return valeur
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** ⚠️ LES CLÉS, PAS LES LIBELLÉS — et l'ORDRE compte : c'est celui de la page
 *  publique. Une table figée aurait gardé « Traction » sous une interface
 *  anglaise, dans la section qui décrit précisément ce que d'autres liront. */
/** ⚠️ LES SEPT, PARCE QUE LA PAGE PROMET « repris de ta Table RM » (FRE-147).
 *  Cette liste était à cinq quand la Table RM l'était ; le bench et le deadlift
 *  l'ayant rejointe, les laisser dehors rendait cette phrase fausse — un coach
 *  y saisirait son développé couché et ne le verrait jamais sur sa vitrine,
 *  sans rien pour le lui dire. */
const RECORDS_AFFICHES = ['muscleUp', 'pullUp', 'chinUp', 'dip', 'squat',
                          'benchPress', 'deadlift'] as const;

/** Le nom d'une langue, dans la langue de l'interface.
 *
 *  ⚠️ REPLI SUR `langues.js` SI LA CLÉ MANQUE, et ce n'est pas de la prudence
 *  gratuite : ce fichier annonce qu'« ajouter une langue = une ligne ici, rien
 *  d'autre ». Sans repli, la treizième langue s'afficherait `coach.langues.xx`
 *  — un identifiant technique au milieu d'une page vitrine. */
function nomDeLangue(code: string, defaut: string, t: TFunction): string {
  return String(t(`coach.langues.${code}`, defaut));
}

export function CoachProfileView() {
  const { t } = useTranslation();
  const { data: profil, isPending } = useMyCoachProfile();
  const patch = usePatchMyCoachProfile();
  const upload = useUploadMyCoachPhoto();
  const fileRef = useRef<HTMLInputElement>(null);

  const existe = Boolean(profil);
  const [form, setForm] = useState({ slug: '', accroche: '', bio: '', instagram: '' });
  const [langues, setLangues] = useState<string[]>([]);

  // Le formulaire se cale sur le serveur à l'arrivée des données, puis à chaque
  // sauvegarde réussie. Dépendre de `profil` et non d'un `isPending` évite de
  // réinitialiser la saisie en cours au moindre re-render.
  useEffect(() => {
    if (!profil) return;
    setForm({
      slug: profil.slug,
      accroche: profil.accroche ?? '',
      bio: profil.bio ?? '',
      instagram: profil.instagram ?? '',
    });
    setLangues(profil.langues ?? []);
  }, [profil]);

  // L'objet gardant le MÊME nom à chaque envoi (`<slug>/profil.png`), le
  // navigateur reservirait l'ancienne image depuis son cache et le coach croirait
  // l'upload raté. Un paramètre qui change à chaque succès force le rechargement.
  const [photoRev, setPhotoRev] = useState(0);

  const slugFinal = existe ? form.slug : slugifier(form.slug);
  const slugInvalide = !existe && form.slug.trim() !== '' && !SLUG_VALIDE.test(slugFinal);

  const enregistrer = () => {
    if (!existe && !slugFinal) {
      toast.error(t('coach.choisisUneAdresse'));
      return;
    }
    const corps: CoachProfilePatch = {
      accroche: form.accroche.trim() || null,
      bio: form.bio.trim() || null,
      instagram: form.instagram.trim() || null,
      // Liste vide = non renseigné : `null` plutôt que `[]`, pour que la page
      // publique n'affiche pas une section « Langues » sans langue.
      langues: langues.length ? langues : null,
    };
    // Le slug n'est envoyé qu'à la CRÉATION : brokkr rejette (409) toute
    // tentative de le changer ensuite, et l'envoyer inchangé serait du bruit.
    if (!existe) corps.slug = slugFinal;

    patch.mutate(corps, {
      onSuccess: () => toast.success(t('coach.pagePubliqueMiseAJour')),
      onError: e => toastSaveError(e),
    });
  };

  const envoyerPhoto = (file: File) => {
    upload.mutate(file, {
      onSuccess: () => {
        setPhotoRev(v => v + 1);
        toast.success('Photo mise en ligne.');
      },
      onError: e => toastSaveError(e),
    });
  };

  if (isPending) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("coach.chargement")}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t("coach.maPagePublique")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("coach.ceQueTuEcrisEst")} <strong className="text-foreground">{t("coach.visibleParToutLeMonde")}</strong>{' '}
          {t("coach.surFrenchForgeSansCompte")}
        </p>
      </header>

      {!existe && (
        <div className="rounded-lg border border-gold/25 bg-gold/5 px-3 py-2 text-xs text-muted-foreground">
          {t("coach.pasEncoreDePage")}{' '}
          <strong className="text-foreground">{t("coach.definitive")}</strong>{t("coach.carLeLienCirculera")}
        </div>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {t("coach.adresseDeLaPage")}
          </span>
          {existe ? (
            <a
              href={`${SITE}/coachs/${profil!.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-sm text-gold hover:underline"
            >
              {SITE}/coachs/{profil!.slug}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <>
              <Input
                value={form.slug}
                onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
                placeholder="prenom-nom"
                aria-label={t("coach.adresseDeLaPage")}
              />
              <span className={cn('text-[11px]', slugInvalide ? 'text-destructive' : 'text-muted-foreground')}>
                {form.slug.trim()
                  ? `${SITE}/coachs/${slugFinal || '…'}`
                  : t('coach.minusculesEtTirets')}
              </span>
            </>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t('coach.accroche')}</span>
          <Input
            value={form.accroche}
            onChange={e => setForm(f => ({ ...f, accroche: e.target.value }))}
            placeholder={t("coach.accrochePlaceholder")}
            aria-label={t('coach.accroche')}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t('coach.bio')}</span>
          <textarea
            value={form.bio}
            onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            rows={4}
            placeholder={t("coach.bioPlaceholder")}
            aria-label={t('coach.bio')}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Instagram</span>
          <Input
            type="url"
            value={form.instagram}
            onChange={e => setForm(f => ({ ...f, instagram: e.target.value }))}
            placeholder={t("coach.instagramPlaceholder")}
            aria-label="Instagram"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("coach.languesParlees")}</span>
          {/* Puces + menu déroulant plutôt qu'une liste à cocher : un coach en
              déclare deux ou trois sur une douzaine, et les puces montrent d'un
              coup d'œil ce qui est retenu — ce qu'une liste de cases oblige à
              parcourir. Même motif que les mouvements de la BASE. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {langues.map(code => {
              const l = langue(code);
              return (
                <span key={code}
                  className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/5 px-2.5 py-1 text-xs">
                  <span aria-hidden>{l.drapeau}</span>
                  {nomDeLangue(l.code, l.nom, t)}
                  <button type="button" aria-label={t("coach.retirerLangue", { nom: nomDeLangue(l.code, l.nom, t) })}
                    onClick={() => setLangues(v => v.filter(c => c !== code))}
                    className="text-muted-foreground hover:text-destructive">×</button>
                </span>
              );
            })}
            {LANGUES.some(l => !langues.includes(l.code)) && (
              <select
                value=""
                aria-label={t("coach.ajouterUneLangue")}
                onChange={e => {
                  const code = e.target.value;
                  if (code) setLangues(v => [...v, code]);
                }}
                className="h-8 rounded-md border border-dashed border-border bg-background px-2 text-xs text-muted-foreground outline-none focus:border-gold"
              >
                <option value="">{t("coach.ajouterUneLangueOption")}</option>
                {LANGUES.filter(l => !langues.includes(l.code)).map(l => (
                  <option key={l.code} value={l.code}>{l.drapeau} {nomDeLangue(l.code, l.nom, t)}</option>
                ))}
              </select>
            )}
          </div>
        </label>

        <div className="flex items-center gap-2">
          <Button onClick={enregistrer} disabled={patch.isPending || slugInvalide}>
            {patch.isPending
              ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              : <Save className="mr-1.5 h-4 w-4" />}
            {t("coach.enregistrer")}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">{t('common.photo')}</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background/50">
            {profil?.photoUrl ? (
              <img
                src={`${profil.photoUrl}?v=${photoRev}`}
                alt={t("coach.taPhotoDeProfil")}
                className="h-full w-full object-contain"
              />
            ) : (
              <ImageIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              {t("coach.photoContraintes")}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png"
              className="hidden"
              aria-label={t("coach.choisirUnePhoto")}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) envoyerPhoto(file);
                e.target.value = ''; // re-sélectionner le MÊME fichier doit relancer l'envoi
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!existe || upload.isPending}
              onClick={() => fileRef.current?.click()}
              title={existe ? undefined : t("coach.enregistreDAbordTaPage")}
            >
              {upload.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <ImageIcon className="mr-1.5 h-4 w-4" />}
              {t("coach.changerLaPhoto")}
            </Button>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-[11px] uppercase tracking-wider text-muted-foreground">{t("coach.recordsAffiches")}</h2>
        {/* LECTURE SEULE, et c'est intentionnel : ces chiffres viennent de la
            Table RM et sont recopiés chaque nuit. Un champ éditable ici
            promettrait une écriture que brokkr refuse, et le coach croirait
            corriger un chiffre qui redeviendrait faux le lendemain. */}
        <p className="text-xs text-muted-foreground">
          {t("coach.recordsReprisDeLaTableRm")}
        </p>
        <dl className="flex flex-wrap gap-2">
          {RECORDS_AFFICHES.map(cle => {
            const label = t(`coach.records.${cle}`);
            const valeur = profil?.oneRm?.[cle as keyof typeof profil.oneRm] ?? 0;
            return (
              <div
                key={cle}
                className={cn(
                  'rounded-md border px-2.5 py-1.5',
                  valeur ? 'border-gold/30 bg-gold/5' : 'border-border opacity-50',
                )}
              >
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
                <dd className="font-mono text-sm tabular-nums">{valeur ? `${valeur} kg` : '—'}</dd>
              </div>
            );
          })}
        </dl>
      </section>
    </div>
  );
}
