import { useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

import { useCreateAthlete } from '@/api/hooks/use-athletes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { toastSaveError } from '@/lib/save-error';
import { cn } from '@/lib/utils';

/** AJOUTER UN ATHLÈTE — l'entrée de la sidebar, sous la liste des athlètes.
 *
 *  ⚠️ LE GESTE EXISTAIT CÔTÉ SERVEUR ET NULLE PART À L'ÉCRAN. `POST /athletes`
 *  est en `require_coach` depuis toujours, et il pose `coach_uid = <l'appelant>`
 *  — un coach qui crée obtient donc un athlète RATTACHÉ À LUI, sans réassignation.
 *  Le seul bouton de l'app vivait pourtant dans la vue Admin, derrière `isAdmin` :
 *  un coach non-admin ne pouvait pas ajouter d'athlète, alors que le serveur
 *  l'acceptait. C'est la règle d'affordance du projet prise à l'envers — on ne
 *  proposait pas une écriture permise.
 *
 *  ⚠️ ET LA GARDE EST `isCoach`, PAS `isAdmin`. Les deux sont INDÉPENDANTS côté
 *  brokkr : `is_coach` = une ligne dans `coaches`, `is_admin` = `users.is_admin`.
 *  Un admin qui ne serait pas coach prendrait un 403 — l'ancien bouton l'aurait
 *  affiché quand même. Ici la condition d'affichage est exactement celle que le
 *  serveur applique.
 *
 *  ⚠️ « AJOUTER », ET SURTOUT PAS « INVITER » — le premier libellé disait
 *  « Inviter », ce qui promettait un mail que rien n'envoie (l'app n'a AUCUN
 *  chemin d'envoi, ni ici ni dans brokkr). On crée une fiche portant un prénom et
 *  un email ; le coach fait sa programmation, puis donne le lien de l'app de la
 *  main à la main. L'athlète se rattache TOUT SEUL à sa première connexion,
 *  `POST /athletes/link` rapprochant sur l'email.
 *
 *  ⚠️ D'OÙ LE LIBELLÉ DU CHAMP : « Email du compte Google », et non « Email ».
 *  Ce n'est pas une adresse de contact mais la CLÉ du rapprochement — une autre
 *  adresse que celle du compte utilisé pour se connecter ne rattache rien, et
 *  l'athlète voit alors « ton coach ne t'a pas encore enregistré », qui accuse
 *  le coach à tort. Le remède existe (corriger l'email dans « Éditer le profil »,
 *  l'athlète recharge) mais il suppose de comprendre ce qui s'est passé.
 */
export function AjouterUnAthlete() {
  const { t } = useTranslation();
  const creer = useCreateAthlete();
  const [ouvert, setOuvert] = useState(false);
  const [prenom, setPrenom] = useState('');
  const [email, setEmail] = useState('');

  const valide = prenom.trim().length > 0 && email.trim().length > 0;

  const fermer = () => {
    setOuvert(false);
    setPrenom('');
    setEmail('');
  };

  const ajouter = () => {
    if (!valide || creer.isPending) return;
    creer.mutate(
      { firstName: prenom.trim(), email: email.trim() },
      {
        onSuccess: () => {
          toast.success(t('ajouterAthlete.succes', { prenom: prenom.trim() }));
          fermer();
        },
        onError: toastSaveError,
      },
    );
  };

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={t('ajouterAthlete.action')}
          className="h-9 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground"
          onClick={() => setOuvert(true)}
        >
          <UserPlus className="h-4 w-4 text-gold/70" />
          <span>{t('ajouterAthlete.action')}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <DialogPrimitive.Root open={ouvert} onOpenChange={o => { if (!o) fermer(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            )}
          />
          <DialogPrimitive.Content
            className={cn(
              'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2',
              'rounded-xl border border-border/80 bg-card p-5 shadow-[0_24px_60px_rgba(0,0,0,0.45)]',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            )}
          >
            <div className="flex gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/15">
                <UserPlus className="h-4.5 w-4.5 text-gold" />
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-sm font-semibold text-foreground">
                  {t('ajouterAthlete.titre')}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t('ajouterAthlete.explication')}
                </DialogPrimitive.Description>
              </div>
            </div>

            {/* Un vrai <form> : la touche Entrée valide depuis n'importe quel
                champ, sans écouteur clavier à écrire. */}
            <form
              className="mt-4 flex flex-col gap-2"
              onSubmit={e => { e.preventDefault(); ajouter(); }}
            >
              <Input
                value={prenom}
                onChange={e => setPrenom(e.target.value)}
                placeholder={t('admin.prenom')}
                aria-label={t('admin.prenom')}
                maxLength={100}
                autoFocus
                className="h-9 text-sm"
              />
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('ajouterAthlete.email')}
                aria-label={t('ajouterAthlete.email')}
                maxLength={200}
                className="h-9 text-sm"
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" size="sm" variant="outline" onClick={fermer}>
                  {t('ajouterAthlete.annuler')}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!valide || creer.isPending}
                  className="bg-gold text-gold-foreground hover:bg-gold/90"
                >
                  {t('ajouterAthlete.valider')}
                </Button>
              </div>
            </form>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
