import { describe, expect, it } from 'vitest';

import { _masquerPourTest as masquer } from '@/lib/observabilite';

/** Ce qui quitte le navigateur pour Sentry.
 *
 *  ⚠️ CES SPECS PROTÈGENT UNE FRONTIÈRE EXTERNE. Une régression ici ne casse
 *  aucun écran et ne fait échouer aucun test métier : elle fuite, en silence.
 *  L'hébergement UE règle le transfert, pas l'hébergement de données de santé —
 *  la règle reste que rien de sensible n'arrive là-bas.
 */

describe('masquage avant envoi', () => {
  it('retire l’identifiant d’un athlète d’une URL', () => {
    const masqué = masquer('GET /athletes/4UsjDzSJkaLS1fMBk5ck/daily-logs 500');
    expect(masqué).not.toContain('4UsjDzSJkaLS1fMBk5ck');
    expect(masqué).toContain('/athletes/{id}/daily-logs');
  });

  it('garde le REGROUPEMENT intact — deux athlètes, un seul texte', () => {
    // ⚠️ LA RAISON DU JETON STABLE. Sentry regroupe par le texte : un masquage
    // aléatoire ferait ressembler une panne unique à cinquante-huit erreurs
    // distinctes, et aucun seuil d'alerte ne se déclencherait.
    expect(masquer('/athletes/4UsjDzSJkaLS1fMBk5ck/tracking'))
      .toEqual(masquer('/athletes/yNSrYedFmXbQYGooNcec/tracking'));
  });

  it('masque la valeur mise en avant par les messages de brokkr', () => {
    // Les `detail` du serveur encadrent la valeur fautive — un mouvement, une
    // catégorie de poids. Utile en local, hors sujet chez un tiers.
    expect(masquer('mouvement « SQUAT » : doit être un lift de compétition'))
      .not.toContain('SQUAT');
  });

  it('couvre les quatre familles de chemins qui désignent une personne', () => {
    for (const famille of ['athletes', 'programs', 'competitions', 'events']) {
      expect(masquer(`/${famille}/4UsjDzSJkaLS1fMBk5ck`)).toEqual(`/${famille}/{id}`);
    }
  });

  it('laisse intact ce qui ne désigne personne', () => {
    // Un masquage trop large rendrait les traces illisibles — l'inverse du but.
    expect(masquer('TypeError: cannot read property of undefined'))
      .toEqual('TypeError: cannot read property of undefined');
  });
});
