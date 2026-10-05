import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, ImageOff, Upload, X } from 'lucide-react';

import { useMediasDemo, useTeleverserMedia } from '@/api/hooks/use-bilan-medias';
import type { BilanTest } from '@/api/types';
import { Button } from '@/components/ui/button';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** LES IMAGES DE DÉMONSTRATION D'UN TEST (FRE-99, lot B).
 *
 *  Ce que Thomas dépose pour montrer un mouvement : les photos qui vivent encore
 *  dans un PDF. Le protocole écrit dit ce qu'il faut faire, l'image le montre —
 *  et sur un geste de mobilité, l'image dit ce qu'aucune phrase ne dit.
 *
 *  ⚠️ PLUSIEURS, ET ORDONNÉES. Le formulaire papier le faisait déjà : départ,
 *  passage, arrivée. Une seule image obligerait à choisir laquelle des trois
 *  compte le plus, ce qui n'est pas une question à laquelle on peut répondre.
 *
 *  ⚠️ UNE MÉDIATHÈQUE PARTAGÉE, PAS DES FICHIERS PAR TEST. Un même départ de
 *  mouvement sert à plusieurs tests, et le catalogue permet de le réutiliser au
 *  lieu de le re-téléverser. C'est aussi ce qui rend le rattachement réversible :
 *  détacher n'efface rien.
 *
 *  ⚠️ ET UNE URL PEUT ÊTRE `null`. Elle est signée et expire (le seau est privé) ;
 *  sans stockage joignable — clé absente, ou expirée, cf. FRE-104 — le catalogue
 *  répond quand même, sans vignettes. Ce composant doit donc afficher l'absence
 *  proprement plutôt que des cadres cassés : une vignette manquante n'empêche
 *  pas de composer.
 */

const TAILLE_MAX = 5 * 1024 * 1024;

function Vignette({ url, alt, className }: { url: string | null; alt: string; className?: string }) {
  const { t: traduire } = useTranslation();
  if (!url) {
    // ⚠️ PAS UN `<img>` SANS SOURCE. Un `src` vide déclenche une requête sur la
    // page courante dans certains navigateurs, et affiche l'icône « image
    // cassée » — ce qui ressemble à un bug alors que c'est un état connu.
    return (
      <span className={cn('grid place-items-center bg-muted/40 text-muted-foreground', className)}
            title={traduire('suiviKine.vignetteIndisponible')}>
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  return <img src={url} alt={alt} loading="lazy" className={cn('object-cover', className)} />;
}

export function MediaDuTest({ test, onChoisir }: {
  test: BilanTest;
  /** La liste ENTIÈRE, dans l'ordre voulu — `[]` détache tout. */
  onChoisir: (mediaIds: string[]) => void;
}) {
  const { t: traduire } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const { data: medias = [], isLoading } = useMediasDemo(ouvert);
  const televerser = useTeleverserMedia();
  const champ = useRef<HTMLInputElement>(null);

  const posees = test.medias ?? [];
  const ids = posees.map(m => m.id);

  // ⚠️ BASCULE PLUTÔT QU'AJOUT : recliquer une image déjà posée la retire. Sans
  // ça, la seule façon de se corriger serait de refermer la médiathèque et
  // d'aller chercher la croix de la vignette — deux gestes pour défaire un clic.
  const basculer = (id: string) =>
    onChoisir(ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const envoyer = (fichier: File | undefined) => {
    if (!fichier) return;
    // ⚠️ LA BORNE EST RAPPELÉE ICI alors que le serveur la tient déjà (413) :
    // sur une connexion de salle, envoyer 20 Mo pour se faire refuser au bout de
    // trente secondes est une mauvaise façon d'apprendre la limite.
    if (fichier.size > TAILLE_MAX) {
      toastSaveError(new Error('Image trop lourde (max 5 Mo)'));
      return;
    }
    televerser.mutate(fichier, {
      // Une image qu'on vient de déposer est une image qu'on veut poser : elle
      // s'ajoute à la fin, là où l'œil l'attend.
      onSuccess: media => onChoisir([...ids, media.id]),
      onError: toastSaveError,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{traduire('suiviKine.imagesDeDemonstration')}</span>

      <div className="flex flex-wrap items-center gap-2">
        {posees.map((m, i) => (
          <span key={m.id} className="relative">
            <Vignette url={m.url} alt={traduire('suiviKine.demonstrationN', { n: i + 1, libelle: test.libelle })}
                      className="h-14 w-20 rounded-md border border-border" />
            <button
              type="button"
              aria-label={traduire('suiviKine.retirerLImage', { n: i + 1, libelle: test.libelle })}
              onClick={() => onChoisir(ids.filter(x => x !== m.id))}
              className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {posees.length === 0 && (
          <span className="text-xs text-muted-foreground/70">{traduire('suiviKine.aucuneImage')}</span>
        )}

        <Button size="sm" variant="outline" onClick={() => setOuvert(o => !o)}>
          <ImagePlus className="h-3.5 w-3.5" />
          {traduire(posees.length ? 'common.edit' : 'suiviKine.choisir')}
        </Button>
      </div>

      {ouvert && (
        <div className="rounded-lg border border-border bg-background/60 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {traduire('suiviKine.mediatheque')}
            </span>
            {/* ⚠️ L'ENVOI EST DANS LE MÊME PANNEAU QUE LE CHOIX. Séparer les deux
                obligerait à téléverser ailleurs, revenir, puis chercher — alors
                que le geste réel est « je n'ai pas cette image, je l'ajoute ». */}
            <Button size="sm" variant="outline" disabled={televerser.isPending}
                    onClick={() => champ.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
              {traduire(televerser.isPending ? 'suiviKine.envoiEnCours' : 'suiviKine.televerser')}
            </Button>
            <input
              ref={champ}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={e => { envoyer(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>

          {isLoading ? (
            <p className="text-xs text-muted-foreground">{traduire('common.loading')}</p>
          ) : medias.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {traduire('suiviKine.aucuneImagePourLInstant')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {medias.map(m => {
                // ⚠️ LE RANG EST AFFICHÉ, PAS SEULEMENT LA SÉLECTION. Trois
                // photos posées dans le désordre racontent une autre histoire :
                // sans le numéro, rien à l'écran ne dit dans quel ordre elles
                // partiront.
                const rang = ids.indexOf(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      aria-label={m.legende ?? traduire('suiviKine.imageSansLegende')}
                      aria-pressed={rang >= 0}
                      onClick={() => basculer(m.id)}
                      className={cn(
                        'relative block overflow-hidden rounded-md border transition-colors',
                        rang >= 0
                          ? 'border-primary ring-1 ring-primary/40'
                          : 'border-border hover:border-primary/50',
                      )}
                    >
                      <Vignette url={m.url} alt={m.legende ?? ''} className="h-14 w-20" />
                      {rang >= 0 && (
                        <span className="absolute left-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {rang + 1}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
