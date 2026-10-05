import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { decouper, rejoindre } from './antecedents-texte';
import { Plus, X } from 'lucide-react';

/** LES ANTÉCÉDENTS, un par ligne.
 *
 *  ⚠️ LE SÉPARATEUR EST LE RETOUR À LA LIGNE, ET CE N'EST PAS UN BRICOLAGE. La
 *  colonne est un `text` (cf. `bilan-kine.md` §2), donc il faut bien couper
 *  quelque part — mais on n'invente rien : le saut de ligne est exactement ce
 *  qu'une personne écrit d'elle-même pour lister. Un `;` ou un `|` aurait été un
 *  code à connaître, et se serait retrouvé affiché tel quel le jour où quelqu'un
 *  relit la colonne à la main.
 *
 *  ⚠️ ET LA COLONNE RESTE LISIBLE BRUTE, ce qui compte pour un champ médical : un
 *  export, une requête de vérification ou une reprise après incident donnent un
 *  texte qu'un humain lit sans le décoder. Une table dédiée ou un `text[]`
 *  auraient été plus « propres » et auraient coûté ça.
 *
 *  Le prix, assumé : un antécédent ne peut pas CONTENIR de saut de ligne. Les
 *  champs sont donc des `input` d'une ligne, ce qui rend le cas impossible plutôt
 *  que d'avoir à le gérer.
 */

export function Antecedents({ valeur, lecture, onCommit }: {
  valeur: string | null | undefined;
  lecture: boolean;
  onCommit: (v: string | null) => void;
}) {
  const { t: traduire } = useTranslation();
  const lignes = decouper(valeur);
  if (!lecture) return <AntecedentsEdition lignes={lignes} onCommit={onCommit} />;

  return lignes.length ? (
    <ul className="flex flex-col gap-1">
      {lignes.map((l, i) => (
        <li key={i} className="flex gap-2 text-sm text-foreground">
          <span className="text-primary">·</span>{l}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted-foreground">{traduire('suiviKine.aucunAntecedent')}</p>
  );
}

function AntecedentsEdition({ lignes, onCommit }: {
  lignes: string[];
  onCommit: (v: string | null) => void;
}) {
  const { t: traduire } = useTranslation();

  // ⚠️ LES CHAMPS VIDES SONT UN ÉTAT LOCAL, ET C'EST CE QUI REND LE BOUTON POSSIBLE.
  // La valeur enregistrée ne peut pas porter une ligne vide — `rejoindre` les
  // écarte, et c'est voulu : un antécédent vide n'existe pas. Sans compteur local,
  // « ajouter » n'aurait donc rien à afficher, l'ajout disparaissant aussitôt.
  //
  // Il repart à zéro dès qu'une saisie est enregistrée : la ligne vide est devenue
  // une vraie ligne, et en garder une de plus empilerait les champs fantômes.
  const [enPlus, setEnPlus] = useState(0);

  // Une liste vide s'ouvre sur un champ, sinon elle n'offrirait rien à quoi
  // commencer — il faudrait cliquer « ajouter » pour pouvoir écrire le premier.
  //
  // ⚠️ `enPlus + 1` ET NON `Math.max(enPlus, 1)`, qui ABSORBAIT LE PREMIER CLIC :
  // sur une liste vide, le champ offert d'emblée et le premier ajout se
  // confondaient en un seul, et le bouton semblait ne rien faire — le défaut
  // qu'on venait justement de corriger, reparu sous une autre forme.
  const vides = lignes.length === 0 ? enPlus + 1 : enPlus;
  const champs = [...lignes, ...Array<string>(vides).fill('')];

  const enregistrer = (suivant: string[]) => {
    setEnPlus(0);
    onCommit(rejoindre(suivant));
  };

  return (
    <div className="flex flex-col gap-1.5">
      {champs.map((l, i) => (
        <div key={`${i}-${l}`} className="flex items-center gap-1.5">
          <input
            type="text"
            defaultValue={l}
            autoFocus={!l && i > 0 && i === champs.length - 1}
            placeholder={traduire(i === 0 && !l ? 'suiviKine.exempleAntecedent' : 'suiviKine.autreAntecedent')}
            onBlur={e => {
              if (e.target.value.trim() === l) return;
              const suivant = [...champs];
              suivant[i] = e.target.value;
              enregistrer(suivant);
            }}
            className="h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground/60"
          />
          {l && (
            <button
              type="button"
              title={traduire('suiviKine.retirerCetAntecedent')}
              onClick={() => enregistrer(champs.filter((_, j) => j !== i))}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* ⚠️ UN VRAI BOUTON, PAS UNE LIGNE D'AIDE. Il y avait ici un « + une ligne
          par antécédent » en petit gris : un plus qui ne cliquait pas, à côté d'un
          champ vide permanent qui, lui, était le seul moyen d'ajouter. L'affordance
          était donc portée par ce qui n'en avait pas l'air, et annoncée par ce qui
          en avait l'air sans l'être. Signalé par William le 21/08.

          Bordure pointillée : la convention du « à remplir » — il se distingue des
          champs pleins sans crier plus fort qu'eux. */}
      <button
        type="button"
        onClick={() => setEnPlus(n => n + 1)}
        className="mt-0.5 inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" /> {traduire('suiviKine.ajouterUnAntecedent')}
      </button>
    </div>
  );
}
